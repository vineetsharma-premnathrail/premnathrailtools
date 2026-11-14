import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../auth/app_lock.dart';
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
        // App lock: only calls made while the person is using the app count
        // as activity (the bell's background refresh does not).
        if (AppLock.instance.userActive && !options.path.startsWith('/notifications/unread-count')) {
          options.headers['X-User-Active'] = '1';
        }
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

        // The session is locked (app password) - show the lock screen.
        if (status == 423) {
          final d = error.response?.data;
          AppLock.instance.onLocked(d is Map ? d['detail']?.toString() : null);
        }

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

  /// A message a user can act on - never code, error classes or raw server
  /// data. The server's own reason is used when it gave one (those are
  /// written for people); otherwise a plain reason + what to do. The real
  /// error still goes to the debug log for diagnosis.
  static String describe(Object error) {
    if (kDebugMode && error is! String) debugPrint('describe(): $error');
    if (error is String) return error;
    if (error is DioException) {
      final data = error.response?.data;
      final code = error.response?.statusCode;
      final detail = data is Map ? data['detail'] : null;
      final fields = _validationText(data is Map && data['errors'] is List ? data['errors'] : detail);
      if (fields != null) return fields;
      // 5xx replies can carry internal text - never show it.
      if (detail is String && detail.trim().isNotEmpty && (code == null || code < 500)) return detail.trim();
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.connectionError:
          return 'Could not reach the server. Check your internet connection and try again.';
        case DioExceptionType.receiveTimeout:
          return 'The server is taking too long to answer. Wait a moment and try again - '
              'a save you already sent is not done twice.';
        case DioExceptionType.cancel:
          return 'The request was stopped. Try again.';
        default:
          break;
      }
      switch (code) {
        case 400:
          return 'This could not be done with the details given. Check the form and try again.';
        case 401:
          return 'Your login has ended. Close and open the app to log in again.';
        case 403:
          return 'You don\'t have permission to do this. Ask your admin to give your role access.';
        case 404:
          return 'This record was not found - it may have been deleted or moved. Go back and refresh the list.';
        case 409:
          return 'Someone else changed this record just now. Go back, refresh and try again.';
        case 413:
          return 'The file is too large to upload. Choose a smaller file (or a lower-quality photo).';
        case 422:
          return 'Some details are missing or not valid. Check the form and try again.';
        case 423:
          return 'The app is locked. Enter your app password to continue.';
        case 429:
          return 'Too many tries in a short time. Wait a minute and try again.';
      }
      if (code != null && code >= 500) {
        return 'The server had a problem with this request. Try again in a few minutes; '
            'if it keeps happening, tell your admin.';
      }
      return 'Something went wrong talking to the server. Try again.';
    }
    // Our own plain-language errors: throw Exception('...').
    final text = error.toString();
    if (error.runtimeType.toString() == '_Exception' && text.startsWith('Exception: ')) {
      return text.substring('Exception: '.length);
    }
    // Anything else is a program error - show a calm message, not its text.
    return 'Something went wrong on this screen. Go back and open it again; '
        'if it keeps happening, tell your admin.';
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
