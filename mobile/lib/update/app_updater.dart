import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api_client.dart';
import '../auth/app_lock.dart';
import '../auth/auth_service.dart';
import '../config.dart';

/// One published version of the app (GET /mobile-app/latest).
class AppRelease {
  AppRelease({
    required this.id,
    required this.versionName,
    required this.versionCode,
    required this.notes,
    required this.required,
    required this.minSupportedVersionCode,
    required this.fileSize,
    required this.sha256,
    required this.releasedAt,
    required this.downloadPath,
  });

  final Object? id;
  final String versionName;
  final int versionCode;
  final String notes;
  final bool required;
  final int minSupportedVersionCode;
  final int fileSize;
  final String sha256;
  final DateTime? releasedAt;
  final String downloadPath;

  static int _int(Object? v) => v is int ? v : int.tryParse('${v ?? ''}') ?? 0;

  static AppRelease? fromJson(Object? data) {
    if (data is! Map) return null;
    final code = _int(data['version_code']);
    final path = (data['download_path'] ?? '').toString();
    final hash = (data['sha256'] ?? '').toString().trim().toLowerCase();
    if (code <= 0 || path.isEmpty || hash.isEmpty) return null;
    return AppRelease(
      id: data['id'],
      versionName: (data['version_name'] ?? '').toString(),
      versionCode: code,
      notes: (data['notes'] ?? '').toString(),
      required: data['required'] == true,
      minSupportedVersionCode: _int(data['min_supported_version_code']),
      fileSize: _int(data['file_size']),
      sha256: hash,
      releasedAt: DateTime.tryParse((data['released_at'] ?? '').toString()),
      downloadPath: path,
    );
  }
}

enum UpdateState { idle, checking, upToDate, available, downloading, readyToInstall, installing, error }

/// Keeps the app up to date: checks the server after login and every 6
/// hours, downloads a new version quietly, checks its SHA-256 and installs
/// it through Android's package installer (native side: MainActivity.kt,
/// channel 'premnath/updater').
///
/// Automatic installs never pull the app away while someone is working:
/// they run when the app goes to the background or at the next start.
/// "Update now" (and a required update) installs straight away.
class AppUpdater extends ChangeNotifier with WidgetsBindingObserver {
  AppUpdater._();
  static final AppUpdater instance = AppUpdater._();

  static const _channel = MethodChannel('premnath/updater');
  static const checkEvery = Duration(hours: 6);

  /// For the pre-signed storage address only: no login token, no
  /// interceptors (the address itself carries the permission).
  static final Dio _plainDio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(minutes: 2),
  ));

  UpdateState state = UpdateState.idle;

  /// Plain message for [UpdateState.error] (or a calm note after a failed
  /// automatic step). Never code or exception text.
  String? message;

  /// 0..1 while downloading; null when the size is not known yet.
  double? progress;

  AppRelease? latest;
  DateTime? lastCheck;

  String currentVersionName = '';
  int currentVersionCode = 0;

  /// Android says this app may not install apps yet (Settings › Install
  /// unknown apps). The screen explains it and opens the setting.
  bool needsInstallPermission = false;

  bool _attached = false;
  bool _running = false;
  bool _foreground = true;
  Timer? _timer;
  CancelToken? _cancel;
  File? _file;
  Future<void>? _checking;
  Future<bool>? _downloading;

  /// The person said "Cancel" on Android's install question - no automatic
  /// install again until the next app start ("Update now" still works).
  bool _declined = false;

  /// "Update now" was pressed while the install permission was missing:
  /// continue when the person comes back from Settings.
  bool _resumeAfterPermission = false;

  /// A verified download left by an earlier run - install it at this start.
  bool _installAtStart = false;

  /// Releases whose file failed the signer / package / version check in this
  /// session: never retried automatically, and never block the app.
  final Set<String> _rejected = {};
  static String _key(AppRelease r) => '${r.versionCode}:${r.sha256}';
  bool _isRejected(AppRelease? r) => r != null && _rejected.contains(_key(r));

  static const unverifiedText = 'This update could not be verified, so it was not installed. '
      'Do not uninstall the app - tell your admin.';

  /// A newer version exists on the server (and was not rejected).
  bool get hasUpdate =>
      latest != null && latest!.versionCode > currentVersionCode && !_isRejected(latest);

  /// The app may not be used until it is updated.
  bool get mustUpdate {
    final r = latest;
    if (r == null || r.versionCode <= currentVersionCode || _isRejected(r)) return false;
    return r.required || currentVersionCode < r.minSupportedVersionCode;
  }

  String get currentLabel =>
      currentVersionName.isEmpty ? '' : 'Version $currentVersionName ($currentVersionCode)';

  bool get busy =>
      state == UpdateState.checking || state == UpdateState.downloading || state == UpdateState.installing;

  // ── Start / stop ───────────────────────────────────────────────────────────

  /// Called once from main(): follows login and the app lock, and the app's
  /// foreground/background changes.
  Future<void> attach() async {
    if (_attached) return;
    _attached = true;
    WidgetsBinding.instance.addObserver(this);
    _channel.setMethodCallHandler(_onNative);
    try {
      final info = await PackageInfo.fromPlatform();
      currentVersionName = info.version;
      currentVersionCode = int.tryParse(info.buildNumber) ?? 0;
    } catch (_) {
      // Version stays unknown; checks still run (any release is then newer).
    }
    AuthService.instance.addListener(_sync);
    AppLock.instance.addListener(_sync);
    _sync();
    notifyListeners();
  }

  /// Runs only while someone is logged in and the app is unlocked (the
  /// server refuses calls on a locked session).
  /// Release builds talk to the server only over https (the session token
  /// travels with the update check and download).
  static bool get _transportOk {
    if (!kReleaseMode || AppConfig.apiBaseUrl.startsWith('https://')) return true;
    debugPrint('App update: skipped - the server address is not https.');
    return false;
  }

  void _sync() {
    final ready = AuthService.instance.isSignedIn && !AppLock.instance.mustShow && _transportOk;
    if (ready && !_running) {
      _running = true;
      _installAtStart = true;
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(minutes: 15), (_) => _checkIfDue());
      _auto();
    } else if (!AuthService.instance.isSignedIn && _running) {
      _running = false;
      _timer?.cancel();
      _timer = null;
      _cancel?.cancel();
    }
  }

  void _checkIfDue() {
    if (!_running || !_foreground) return;
    final last = lastCheck;
    if (last == null || DateTime.now().difference(last) >= checkEvery) _auto();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _foreground = false;
      // Quiet moment: the person left the app - install a ready update now.
      if (_running && this.state == UpdateState.readyToInstall && !_declined) {
        unawaited(_install(auto: true));
      }
    } else if (state == AppLifecycleState.resumed) {
      _foreground = true;
      if (_resumeAfterPermission) {
        _resumeAfterPermission = false;
        unawaited(_continueAfterPermission());
      } else if (this.state == UpdateState.installing && !_nativeWaiting) {
        // Back from Android's installer without a result (e.g. the manual
        // installer screen was closed) - offer the button again.
        _set(UpdateState.readyToInstall);
      }
      _checkIfDue();
    }
  }

  /// Automatic round: check, download quietly, install at a quiet moment.
  Future<void> _auto() async {
    if (!_running) return;
    await check(quiet: true);
    if (!_running || !hasUpdate) return;
    final ok = await download(quiet: true);
    if (!ok || !_running) return;
    // "At the next start" = the file was already downloaded by an earlier
    // run; a file downloaded just now waits for the app to go to the
    // background (never interrupts someone mid-work).
    final atStart = _installAtStart && _fromEarlierRun;
    _installAtStart = false;
    if ((mustUpdate || atStart || !_foreground) && !_declined) {
      await _install(auto: !mustUpdate);
    }
  }

  /// The verified file came from an earlier run of the app.
  bool _fromEarlierRun = false;

  // ── Check ──────────────────────────────────────────────────────────────────

  /// Asks the server for the newest version. [quiet] = automatic check:
  /// a failure keeps the last known state instead of showing an error.
  Future<void> check({bool quiet = false}) => _checking ??= _check(quiet).whenComplete(() => _checking = null);

  Future<void> _check(bool quiet) async {
    if (state == UpdateState.downloading || state == UpdateState.installing) return;
    if (!_transportOk) return;
    final before = state;
    if (!quiet) {
      message = null;
      _set(UpdateState.checking);
    }
    try {
      final res = await ApiClient.dio.get('/mobile-app/latest');
      lastCheck = DateTime.now();
      final release = AppRelease.fromJson(res.data);
      _applyRelease(release);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        // Nothing published yet - the app is as new as it gets.
        lastCheck = DateTime.now();
        _applyRelease(null);
        return;
      }
      if (e.type == DioExceptionType.cancel) {
        _set(before == UpdateState.checking ? UpdateState.idle : before);
        return;
      }
      _fail(ApiClient.describe(e), quiet: quiet, fallback: before);
    } catch (e) {
      _fail(ApiClient.describe(e), quiet: quiet, fallback: before);
    }
  }

  void _applyRelease(AppRelease? release) {
    final changed = latest?.versionCode != release?.versionCode || latest?.sha256 != release?.sha256;
    latest = release;
    if (_isRejected(release)) {
      // Keep telling why this version is not offered.
      _file = null;
      message = unverifiedText;
      _set(UpdateState.error);
      return;
    }
    if (!hasUpdate) {
      _file = null;
      unawaited(_cleanFolder(keep: null));
      message = null;
      _set(UpdateState.upToDate);
      return;
    }
    if (changed) _file = null;
    if (_file != null) {
      // Same version already downloaded and verified.
      message = null;
      _set(UpdateState.readyToInstall);
      return;
    }
    message = null;
    _set(UpdateState.available);
  }

  // ── Download ───────────────────────────────────────────────────────────────

  /// Downloads [latest] to the app's cache folder and checks its SHA-256.
  /// True when a verified file is ready to install.
  Future<bool> download({bool quiet = false}) =>
      _downloading ??= _download(quiet).whenComplete(() => _downloading = null);

  Future<bool> _download(bool quiet) async {
    final r = latest;
    if (r == null || !hasUpdate) return false;
    if (_file != null && await _file!.exists()) {
      _set(UpdateState.readyToInstall);
      return true;
    }
    final dir = await _folder();
    final target = File('${dir.path}${Platform.pathSeparator}premnath_erp_${r.versionCode}.apk');

    // A file from an earlier run (e.g. downloaded before the app was closed).
    if (await target.exists() && await _hashOf(target) == r.sha256) {
      _fromEarlierRun = true;
      _file = target;
      message = null;
      _set(UpdateState.readyToInstall);
      return true;
    }

    final part = File('${target.path}.part');
    _fromEarlierRun = false;
    message = null;
    progress = r.fileSize > 0 ? 0 : null;
    _set(UpdateState.downloading);
    _cancel = CancelToken();
    try {
      await _cleanFolder(keep: null);
      void onProgress(int got, int total) {
        final size = total > 0 ? total : r.fileSize;
        final p = size > 0 ? (got / size).clamp(0.0, 1.0) : null;
        if (p == null || progress == null || (p - progress!).abs() >= 0.01 || p == 1.0) {
          progress = p;
          notifyListeners();
        }
      }

      // Our server answers with a redirect to a short-lived, pre-signed
      // storage address (or streams the file itself). The redirect is NOT
      // followed by the API client, so our login token never goes to the
      // storage server.
      final first = await ApiClient.dio.get<ResponseBody>(
        _downloadUrl(r.downloadPath),
        cancelToken: _cancel,
        options: Options(
          followRedirects: false,
          maxRedirects: 0,
          validateStatus: (s) => s != null && s < 400,
          responseType: ResponseType.stream,
          receiveTimeout: const Duration(minutes: 2),
          headers: {'Accept': '*/*'},
        ),
      );
      final status = first.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        // Drop the redirect reply's (empty) body before moving on.
        unawaited(first.data?.stream.drain<void>().catchError((_) {}));
        final location = first.headers.value('location');
        if (location == null || location.isEmpty) {
          throw Exception('The server did not say where to download the update from. '
              'Try again; if it keeps happening, tell your admin.');
        }
        final url = Uri.parse('${ApiClient.dio.options.baseUrl}${_downloadUrl(r.downloadPath)}')
            .resolve(location)
            .toString();
        await _plainDio.download(
          url,
          part.path,
          cancelToken: _cancel,
          deleteOnError: true,
          options: Options(extra: {'storage': true}),
          onReceiveProgress: onProgress,
        );
      } else {
        final body = first.data;
        if (body == null) throw Exception('The update could not be downloaded. Try again.');
        final total = int.tryParse(first.headers.value(Headers.contentLengthHeader) ?? '') ?? -1;
        final sink = part.openWrite();
        var got = 0;
        try {
          await for (final chunk in body.stream) {
            if (_cancel?.isCancelled == true) break;
            sink.add(chunk);
            got += chunk.length;
            onProgress(got, total);
          }
        } finally {
          await sink.flush();
          await sink.close();
        }
        if (_cancel?.isCancelled == true) {
          throw DioException(requestOptions: first.requestOptions, type: DioExceptionType.cancel);
        }
      }
      if (await _hashOf(part) != r.sha256) {
        await _delete(part);
        _fail('The downloaded update was damaged. Try again.', quiet: quiet, fallback: UpdateState.available);
        return false;
      }
      if (await target.exists()) await _delete(target);
      _file = await part.rename(target.path);
      progress = 1;
      message = null;
      _set(UpdateState.readyToInstall);
      return true;
    } on DioException catch (e) {
      await _delete(part);
      if (e.type == DioExceptionType.cancel) {
        // Cancel is not an error.
        progress = null;
        _set(UpdateState.available);
        return false;
      }
      final code = e.response?.statusCode;
      final text = e.requestOptions.extra['storage'] == true && e.response != null
          ? 'The download link ran out before the update finished. Tap Update now to try again.'
          : code == 404
          ? 'This update is no longer on the server. Check for updates again.'
          : ApiClient.describe(e);
      _fail(text, quiet: quiet, fallback: UpdateState.available);
      return false;
    } on FileSystemException {
      await _delete(part);
      _fail('The update could not be saved on this phone. Free up some space and try again.',
          quiet: quiet, fallback: UpdateState.available);
      return false;
    } catch (e) {
      await _delete(part);
      _fail(ApiClient.describe(e), quiet: quiet, fallback: UpdateState.available);
      return false;
    } finally {
      _cancel = null;
    }
  }

  /// Stops a running download (not an error).
  void cancelDownload() => _cancel?.cancel();

  /// download_path from the server may be relative to /api/v1, start with
  /// /api/v1, or be a full address.
  /// Only our own server's release download address is accepted (relative,
  /// /mobile-app/releases/...), so the login token never goes to another host.
  String _downloadUrl(String path) {
    var p = path.trim();
    if (p.startsWith('/api/v1/')) p = p.substring('/api/v1'.length);
    final ok = p.startsWith('/mobile-app/releases/') &&
        !p.contains('..') &&
        !p.contains('://') &&
        !p.startsWith('//') &&
        !p.contains('\\');
    if (!ok) {
      throw Exception('This update\'s download address is not valid, so it was not downloaded. Tell your admin.');
    }
    return p;
  }

  Future<Directory> _folder() async {
    final base = await getApplicationCacheDirectory();
    // Same folder as res/xml/updater_file_paths.xml (cache-path "updates/").
    final dir = Directory('${base.path}${Platform.pathSeparator}updates');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Removes old update files (keeps [keep]).
  Future<void> _cleanFolder({File? keep}) async {
    try {
      final dir = await _folder();
      await for (final f in dir.list()) {
        if (f is File && f.path != keep?.path && f.path != _file?.path) await _delete(f);
      }
    } catch (_) {
      // Leftover files only cost space; the next clean-up tries again.
    }
  }

  static Future<String> _hashOf(File f) async {
    try {
      final digest = await sha256.bind(f.openRead()).first;
      return digest.toString();
    } catch (_) {
      return '';
    }
  }

  static Future<void> _delete(File f) async {
    try {
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  // ── Install ────────────────────────────────────────────────────────────────

  /// "Update now": download if needed, then install at once. Returns false
  /// when Android's "Install unknown apps" setting must be turned on first
  /// (the caller explains it and calls [openInstallSettings]).
  Future<bool> updateNow() async {
    _declined = false;
    message = null;
    if (latest == null) await check();
    if (!hasUpdate) return true;
    if (!await canInstall()) {
      needsInstallPermission = true;
      notifyListeners();
      return false;
    }
    final ok = await download();
    if (!ok) return true;
    await _install(auto: false);
    return true;
  }

  Future<bool> canInstall() async {
    try {
      final ok = await _channel.invokeMethod<bool>('canInstall');
      needsInstallPermission = ok != true;
      return ok == true;
    } catch (_) {
      return true; // Older Android or no answer - let the installer decide.
    }
  }

  /// Opens Settings › Install unknown apps for this app; the update goes on
  /// by itself when the person comes back.
  Future<void> openInstallSettings() async {
    _resumeAfterPermission = true;
    try {
      await _channel.invokeMethod<void>('openInstallSettings');
    } catch (_) {
      _resumeAfterPermission = false;
      _fail('The settings screen could not be opened. Open Settings › Apps › Premnath ERP › '
          'Install unknown apps, turn it on, then come back and tap Update now.');
    }
  }

  Future<void> _continueAfterPermission() async {
    if (!await canInstall()) {
      notifyListeners();
      return;
    }
    needsInstallPermission = false;
    await updateNow();
  }

  bool _nativeWaiting = false;

  Future<void> _install({required bool auto}) async {
    final f = _file;
    if (f == null || !await f.exists()) {
      _file = null;
      if (hasUpdate) _set(UpdateState.available);
      return;
    }
    if (!await canInstall()) {
      // Automatic installs never open Settings by themselves.
      notifyListeners();
      if (!auto) _set(UpdateState.readyToInstall);
      return;
    }
    message = null;
    _set(UpdateState.installing);
    final release = latest;
    if (release == null || !await _verifySigner(f, release)) {
      await _delete(f);
      _file = null;
      if (release != null) _rejected.add(_key(release));
      message = unverifiedText;
      _set(UpdateState.error);
      return;
    }
    try {
      final code = await _channel.invokeMethod<String>('installApk', {'path': f.path});
      _handleCode(code ?? 'failed', auto: auto);
    } catch (_) {
      _handleCode('failed', auto: auto);
    }
  }

  /// The file must be this very app (same package), signed with the same
  /// key(s) as the running app, newer than it, and exactly the version the
  /// server announced.
  Future<bool> _verifySigner(File f, AppRelease r) async {
    try {
      final info = await _channel.invokeMapMethod<String, dynamic>('verifyApk', {'path': f.path});
      if (info == null || info['ok'] != true) return false;
      final pkg = info['packageName'];
      final own = info['ownPackage'];
      final code = (info['versionCode'] as num?)?.toInt() ?? -1;
      final ownCode = (info['ownVersionCode'] as num?)?.toInt() ?? 1 << 62;
      final signers = ((info['signers'] as List?) ?? const []).map((e) => '$e').toSet();
      final ownSigners = ((info['ownSigners'] as List?) ?? const []).map((e) => '$e').toSet();
      return pkg is String &&
          pkg == own &&
          signers.isNotEmpty &&
          signers.length == ownSigners.length &&
          signers.containsAll(ownSigners) &&
          code > ownCode &&
          code == r.versionCode;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> _onNative(MethodCall call) async {
    if (call.method == 'installResult') {
      _handleCode('${call.arguments ?? 'failed'}', auto: false);
    }
    return null;
  }

  /// Native result codes -> state + plain wording.
  void _handleCode(String code, {required bool auto}) {
    switch (code) {
      case 'started':
      case 'fallback':
        _nativeWaiting = code == 'started';
        _set(UpdateState.installing);
        return;
      case 'waiting_user':
        // Android shows its own "Install" question.
        _nativeWaiting = true;
        _set(UpdateState.installing);
        return;
      case 'success':
        _nativeWaiting = false;
        message = null;
        _set(UpdateState.installing);
        return;
      case 'cancelled':
        _nativeWaiting = false;
        _declined = true;
        message = null;
        _set(UpdateState.readyToInstall);
        return;
      case 'no_permission':
        _nativeWaiting = false;
        needsInstallPermission = true;
        _set(UpdateState.readyToInstall);
        return;
      case 'file_missing':
        _nativeWaiting = false;
        _file = null;
        _fail('The update file is missing. Tap Update now to download it again.',
            quiet: auto, fallback: UpdateState.available);
        return;
      case 'invalid':
        _nativeWaiting = false;
        final f = _file;
        _file = null;
        if (f != null) unawaited(_delete(f));
        _fail('The update file could not be installed. Tap Update now to download it again; '
            'if it keeps happening, tell your admin.', quiet: auto, fallback: UpdateState.available);
        return;
      case 'no_space':
        _nativeWaiting = false;
        _fail('There is not enough free space on this phone to install the update. '
            'Free up some space and tap Update now.', quiet: auto, fallback: UpdateState.readyToInstall);
        return;
      case 'conflict':
        _nativeWaiting = false;
        final f = _file;
        _file = null;
        if (f != null) unawaited(_delete(f));
        final r = latest;
        if (r != null) _rejected.add(_key(r));
        message = unverifiedText;
        _set(UpdateState.error);
        return;
      case 'incompatible':
        _nativeWaiting = false;
        _fail('This update does not work on this phone\'s Android version. Tell your admin.',
            quiet: auto, fallback: UpdateState.readyToInstall);
        return;
      case 'blocked':
        _nativeWaiting = false;
        _fail('Android blocked this update. Check that Premnath ERP may install apps '
            '(Settings › Install unknown apps), or tell your admin.',
            quiet: auto, fallback: UpdateState.readyToInstall);
        return;
      default:
        _nativeWaiting = false;
        _fail('The update could not be installed. Tap Update now to try again; '
            'if it keeps happening, tell your admin.', quiet: auto, fallback: UpdateState.readyToInstall);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  void _fail(String text, {bool quiet = false, UpdateState? fallback}) {
    message = text;
    // Automatic steps keep the last good state; the screen still shows the
    // note so the person knows why nothing happened.
    _set(quiet && fallback != null ? fallback : UpdateState.error);
  }

  void _set(UpdateState s) {
    state = s;
    if (s != UpdateState.downloading) progress = s == UpdateState.readyToInstall ? 1 : null;
    notifyListeners();
  }
}
