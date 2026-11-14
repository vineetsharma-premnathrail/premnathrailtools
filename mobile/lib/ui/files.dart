import 'dart:io';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../config.dart';

/// A file download in progress - shown app-wide by DownloadOverlay.
class FileTransfer {
  FileTransfer(this.fileName, this.cancelToken, {this.received = 0, this.total = 0});
  final String fileName;
  final CancelToken cancelToken;
  final int received;

  /// 0 when the server did not say the size.
  final int total;

  double? get fraction => total > 0 ? (received / total).clamp(0.0, 1.0) : null;
}

/// Files, camera and links - the phone side of the portal's FileUploadField
/// and download buttons.
class Files {
  Files._();

  /// The download running now (null = none); drives the progress card.
  static final ValueNotifier<FileTransfer?> transfer = ValueNotifier(null);

  /// Photo from the camera (site photos, SR updates). Null when cancelled.
  static Future<MultipartFile?> takePhoto() => _image(ImageSource.camera);

  /// Photo from the gallery. Null when cancelled.
  static Future<MultipartFile?> pickPhoto() => _image(ImageSource.gallery);

  static Future<MultipartFile?> _image(ImageSource source) async {
    final x = await ImagePicker().pickImage(source: source, imageQuality: 80, maxWidth: 2400);
    if (x == null) return null;
    return MultipartFile.fromFile(x.path, filename: x.name);
  }

  /// Any document (PDF, Word, Excel, image). Null when cancelled.
  static Future<MultipartFile?> pickFile({List<String>? extensions}) async {
    final f = await FilePicker.pickFile(
      type: extensions == null ? FileType.any : FileType.custom,
      allowedExtensions: extensions,
    );
    if (f == null || f.path == null) return null;
    return MultipartFile.fromFile(f.path!, filename: f.name);
  }

  /// Several documents at once.
  static Future<List<MultipartFile>> pickFiles() async {
    final res = await FilePicker.pickFiles();
    return [
      for (final f in res)
        if (f.path != null) await MultipartFile.fromFile(f.path!, filename: f.name),
    ];
  }

  /// Downloads an API file (with the session token) and opens it in the
  /// phone's viewer (PDF, Word, Excel, image). Throws with a readable reason.
  static Future<void> downloadAndOpen(String apiPath, String fileName,
      {Map<String, dynamic>? query}) async {
    final dir = await getTemporaryDirectory();
    final safe = fileName.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    final path = '${dir.path}${Platform.pathSeparator}$safe';
    final token = CancelToken();
    transfer.value = FileTransfer(safe, token);
    try {
      await ApiClient.dio.download(apiPath, path, queryParameters: query, cancelToken: token,
          onReceiveProgress: (got, total) {
        transfer.value = FileTransfer(safe, token, received: got, total: total > 0 ? total : 0);
      });
    } on DioException catch (e) {
      // Cancel is the person's choice, not an error.
      if (CancelToken.isCancel(e)) return;
      rethrow;
    } finally {
      if (transfer.value?.cancelToken == token) transfer.value = null;
    }
    final r = await OpenFilex.open(path);
    if (r.type != ResultType.done) {
      throw Exception('The file was downloaded but no app on this phone can open "$safe". '
          'Install a viewer for this file type (for example Microsoft Word or a PDF reader).');
    }
  }

  /// Opens a web link (or tel:/mailto:) outside the app.
  static Future<void> openUrl(String url) async {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok) throw Exception('Could not open $url - no app on this phone handles this link.');
  }

  /// A portal page in the browser, for the few things that stay web-only.
  static Future<void> openInPortal(String path) => openUrl('${AppConfig.portalUrl}$path');
}
