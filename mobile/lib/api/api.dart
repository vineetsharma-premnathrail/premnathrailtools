import 'package:dio/dio.dart';

import 'api_client.dart';

export 'api_client.dart' show ApiClient;

/// Thin helpers over [ApiClient.dio] - same endpoints as frontend/src/lib/api.ts
/// (paths relative to /api/v1). Errors throw [DioException]; show them with
/// `ApiClient.describe(e)` (the server's own reason).
class Api {
  Api._();

  static Dio get dio => ApiClient.dio;

  static Future<dynamic> get(String path, {Map<String, dynamic>? query}) async =>
      (await dio.get(path, queryParameters: _clean(query))).data;

  static Future<dynamic> post(String path, {Object? data, Map<String, dynamic>? query}) async =>
      (await dio.post(path, data: data, queryParameters: _clean(query))).data;

  static Future<dynamic> put(String path, {Object? data}) async => (await dio.put(path, data: data)).data;

  static Future<dynamic> patch(String path, {Object? data}) async => (await dio.patch(path, data: data)).data;

  static Future<dynamic> delete(String path, {Object? data}) async => (await dio.delete(path, data: data)).data;

  /// A list endpoint as rows - accepts a bare list or the usual paged
  /// shapes ({items|results|data: [...], total}).
  static Future<ApiPage> list(String path, {Map<String, dynamic>? query}) async =>
      ApiPage.from(await get(path, query: query));

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    final out = <String, dynamic>{};
    q.forEach((k, v) {
      if (v == null) return;
      if (v is String && v.isEmpty) return;
      out[k] = v;
    });
    return out;
  }
}

/// One JSON record from the API.
typedef Json = Map<String, dynamic>;

/// One page of rows from a list endpoint.
class ApiPage {
  ApiPage(this.rows, {this.total});
  final List<Json> rows;

  /// Server-reported total, when the endpoint pages.
  final int? total;

  factory ApiPage.from(dynamic data) {
    List? raw;
    int? total;
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      for (final k in const ['items', 'results', 'data', 'rows', 'records']) {
        if (data[k] is List) {
          raw = data[k] as List;
          break;
        }
      }
      final t = data['total'] ?? data['count'] ?? data['total_count'];
      if (t is int) total = t;
    }
    final rows = (raw ?? const [])
        .whereType<Map>()
        .map((m) => Map<String, dynamic>.from(m))
        .toList();
    return ApiPage(rows, total: total);
  }
}

/// Nested value by dotted path: `pick(row, 'vendor.name')`.
Object? pick(Map<String, dynamic>? row, String path) {
  Object? cur = row;
  for (final part in path.split('.')) {
    if (cur is Map) {
      cur = cur[part];
    } else {
      return null;
    }
  }
  return cur;
}
