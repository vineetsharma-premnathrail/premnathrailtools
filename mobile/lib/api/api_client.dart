import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../auth/auth_service.dart';
import '../config.dart';

/// One HTTP client for the whole app, pointed at the same FastAPI backend as
/// the portal. Permissions and data scope are enforced there, not here.
class ApiClient {
  ApiClient._();

  static final Dio dio = _build();

  static Dio _build() {
    final dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      contentType: Headers.jsonContentType,
      // Signed record refs beside every id, same as the web client.
      headers: {'X-Record-Refs': '1'},
    ));
    dio.interceptors.add(QueuedInterceptorsWrapper(
      onRequest: (options, handler) {
        final token = AuthService.instance.sessionToken;
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        _Idempotency.attach(options);
        handler.next(options);
      },
      onResponse: (response, handler) {
        _Idempotency.settled(response.requestOptions);
        handler.next(response);
      },
      onError: (error, handler) async {
        final options = error.requestOptions;
        final status = error.response?.statusCode;
        if (kDebugMode) {
          debugPrint('API ${options.method} ${options.path} -> '
              '${status ?? error.type.name}: ${error.response?.data}');
        }
        // The server is still busy with the first attempt of this same save:
        // wait and ask again (it then replays that first reply).
        final data = error.response?.data;
        final inProgress = status == 409 && data is Map && data['code'] == 'idempotency_in_progress';
        final tries = (options.extra['idemWaits'] as int?) ?? 0;
        if (inProgress && tries < 10) {
          options.extra['idemWaits'] = tries + 1;
          await Future<void>.delayed(const Duration(milliseconds: 1500));
          try {
            return handler.resolve(await dio.fetch(options));
          } on DioException catch (e) {
            return handler.next(e);
          }
        }
        // A reply came back (even an error): the server dropped the key, so
        // fixing the data and saving again must use a new one. No reply at all
        // (network drop / timeout): keep it, the retry replays the first save.
        if (status != null) _Idempotency.settled(options);

        // The portal session token lives 15 minutes; renew it silently with a
        // fresh Microsoft token and replay the request once.
        final isAuthCall = options.path.startsWith('/auth/');
        if (status == 401 && !isAuthCall && options.extra['retried'] != true) {
          if (await AuthService.instance.renew()) {
            options.extra['retried'] = true;
            options.headers['Authorization'] = 'Bearer ${AuthService.instance.sessionToken}';
            try {
              return handler.resolve(await dio.fetch(options));
            } on DioException catch (e) {
              return handler.next(e);
            }
          }
        }
        handler.next(error);
      },
    ));
    return dio;
  }

  /// A message the user can act on: the server's own reason when it gave one,
  /// otherwise what went wrong with the connection and what to check.
  static String describe(Object error) {
    if (error is DioException) {
      final data = error.response?.data;
      final detail = data is Map ? data['detail'] : null;
      if (detail is String && detail.isNotEmpty) return detail;
      final fields = _validationText(detail);
      if (fields != null) return fields;
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.receiveTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.connectionError:
          return 'Could not reach the server (${AppConfig.apiBaseUrl}). '
              'Check your internet connection and try again; your last save is not repeated twice.';
        default:
          final code = error.response?.statusCode;
          if (code != null) {
            final text = data is String ? data.trim() : (data == null ? '' : '$data');
            return text.isEmpty
                ? 'The server returned error $code with no reason. Please try again in a few minutes.'
                : 'The server returned error $code: $text';
          }
      }
    }
    if (error is String) return error;
    return error.toString().replaceFirst('Exception: ', '');
  }

  /// FastAPI 422: [{loc: [body, field], msg: ...}] -> "Field: message" lines.
  static String? _validationText(Object? detail) {
    if (detail is! List || detail.isEmpty) return null;
    final lines = <String>[];
    for (final d in detail) {
      if (d is! Map) continue;
      final loc = d['loc'] is List
          ? (d['loc'] as List).where((p) => p != 'body' && p != 'query' && p is! int).join(' › ')
          : '';
      final field = loc.toString().replaceAll('_', ' ');
      final msg = (d['msg'] ?? '').toString().replaceFirst('Value error, ', '');
      lines.add(field.isEmpty ? msg : '${field[0].toUpperCase()}${field.substring(1)}: $msg');
    }
    if (lines.isEmpty) return null;
    return 'Please correct: ${lines.join('; ')}';
  }
}

/// Idempotency-Key on every save (backend app/middleware/idempotency.py,
/// portal lib/idempotency.ts). The key belongs to WHAT is saved (method + URL
/// + data): pressing Save again with the same data after a lost reply sends
/// the same key and the server replays the first answer - never two records.
class _Idempotency {
  static const _methods = {'POST', 'PUT', 'PATCH'};
  static final _open = <String, String>{};
  static final _rand = Random.secure();

  static String _newKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return List.generate(32, (_) => chars[_rand.nextInt(chars.length)]).join();
  }

  static void attach(RequestOptions o) {
    if (!_methods.contains(o.method.toUpperCase())) return;
    if (o.path.contains('/auth/') || o.headers.containsKey('Idempotency-Key')) return;
    final data = o.data;
    // Uploads (FormData) can't be fingerprinted - a fresh key each time.
    final fp = data is FormData
        ? null
        : '${o.method} ${o.path} ${jsonEncode(o.queryParameters)} ${_safeJson(data)}';
    final key = fp == null ? _newKey() : (_open[fp] ??= _newKey());
    o.headers['Idempotency-Key'] = key;
    if (fp != null) o.extra['idemFp'] = fp;
  }

  static void settled(RequestOptions o) {
    final fp = o.extra['idemFp'];
    if (fp is String) _open.remove(fp);
  }

  static String _safeJson(Object? v) {
    try {
      return jsonEncode(v);
    } catch (_) {
      return '$v';
    }
  }
}
