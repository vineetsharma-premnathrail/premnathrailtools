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
        handler.next(options);
      },
      onError: (error, handler) async {
        // The portal session token lives 15 minutes; renew it silently with a
        // fresh Microsoft token and replay the request once.
        final options = error.requestOptions;
        if (kDebugMode) {
          debugPrint('API ${options.method} ${options.path} -> '
              '${error.response?.statusCode ?? error.type.name}: ${error.response?.data}');
        }
        final isAuthCall = options.path.startsWith('/auth/');
        if (error.response?.statusCode == 401 && !isAuthCall && options.extra['retried'] != true) {
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
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.receiveTimeout:
        case DioExceptionType.connectionError:
          return 'Could not reach the server (${AppConfig.apiBaseUrl}). '
              'Check your internet connection; for local testing the backend must be running on port 8000.';
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
    return error.toString();
  }
}
