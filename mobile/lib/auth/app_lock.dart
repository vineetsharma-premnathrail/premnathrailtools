import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

import '../api/api_client.dart';

/// The portal's app password lock (backend services/app_lock.py, portal
/// components/shared/AppLock.tsx) on the phone.
///
/// The server enforces it: a new sign-in starts locked, it re-locks after
/// the idle time, and a locked session gets 423 on every data call. The
/// app shows the lock screen over everything until the session is unlocked.
///
/// Fingerprint unlock (phone only, opt-in): after a manual unlock the app
/// password can be kept in the Android Keystore-backed secure storage and
/// is read only after a successful fingerprint check, then sent to the same
/// /unlock endpoint - the server still verifies it, counts wrong tries and
/// audits. If the password was changed on the portal the stored one fails
/// once and is forgotten.
class AppLock extends ChangeNotifier {
  AppLock._();
  static final AppLock instance = AppLock._();

  static const _storage = FlutterSecureStorage();
  static const _pwKey = 'app_lock_password';
  static const _bioKey = 'app_lock_biometric';
  final _auth = LocalAuthentication();

  /// Last /auth/app-lock/status reply.
  Map<String, dynamic> status = const {};

  /// Message from the last 423 (the server's own words).
  String? lockMessage;

  bool get enabled => status['enabled'] == true;
  String get state => (status['state'] as String?) ?? 'unlocked';
  bool get hasPassword => status['has_password'] == true;
  int get minLength => (status['min_length'] as int?) ?? 6;
  String? get maskedEmail => status['email'] as String?;
  Object? get lockedUntil => status['locked_until'];
  bool get tempPending => status['temp_password_pending'] == true;

  /// Lock screen must be shown.
  bool get mustShow => enabled && (state != 'unlocked' || !hasPassword);

  /// What the lock screen asks for.
  bool get needsNewPassword => !hasPassword || state == 'reset';

  bool _bioEnabled = false;
  bool get biometricEnabled => _bioEnabled;

  Future<void> refresh() async {
    try {
      final r = await ApiClient.dio.get('/auth/app-lock/status');
      status = Map<String, dynamic>.from(r.data as Map);
      _bioEnabled = await _storage.read(key: _bioKey) == '1' && await _storage.read(key: _pwKey) != null;
    } on DioException catch (e) {
      // Older backend without the app lock, or a token with no session:
      // nothing to enforce from the phone.
      if (e.response?.statusCode == 404 || e.response?.statusCode == 409) status = const {};
    } catch (_) {}
    notifyListeners();
  }

  /// Called by the API client on any 423.
  void onLocked(String? message) {
    lockMessage = message;
    if (state == 'unlocked' || !enabled) {
      status = {...status, 'enabled': true, 'state': 'locked'};
    }
    notifyListeners();
    unawaited(refresh());
  }

  /// The server's new lock state, held back while the lock screen still has
  /// something to ask (closing the lock screen first would pull its
  /// navigator out from under the open dialog).
  Map<String, dynamic>? _pending;

  Future<void> _apply(Response r, {bool hold = false}) async {
    final next = Map<String, dynamic>.from(r.data as Map);
    if (hold) {
      _pending = next;
      return;
    }
    status = next;
    lockMessage = null;
    notifyListeners();
  }

  /// Shows the state held back by `hold: true` (closes the lock screen).
  void commit() {
    if (_pending == null) return;
    status = _pending!;
    _pending = null;
    lockMessage = null;
    notifyListeners();
  }

  /// State the server reported for the last held-back call.
  String? get pendingState => _pending?['state'] as String?;

  Future<void> unlock(String password, {bool hold = false}) async {
    await _apply(await ApiClient.dio.post('/auth/app-lock/unlock', data: {'password': password}), hold: hold);
  }

  Future<void> setPassword(String newPassword, {String? current, bool hold = false}) async {
    await _apply(
        await ApiClient.dio.post('/auth/app-lock/set',
            data: {'new_password': newPassword, 'current_password': current}),
        hold: hold);
    // A stored fingerprint password is now out of date.
    if (_bioEnabled) await _storage.write(key: _pwKey, value: newPassword);
  }

  Future<String> forgot() async {
    final r = await ApiClient.dio.post('/auth/app-lock/forgot');
    await refresh();
    return (r.data is Map ? r.data['sent_to'] : null)?.toString() ?? 'your email';
  }

  Future<void> lockNow() async {
    await _apply(await ApiClient.dio.post('/auth/app-lock/lock'));
  }

  // ── Activity (portal: X-User-Active header + heartbeat) ──────────────────

  DateTime _lastTouch = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _lastBeat = DateTime.fromMillisecondsSinceEpoch(0);

  /// The person touched the screen in the last minute - only then do API
  /// calls count as activity (background refreshes must not keep it open).
  bool get userActive => DateTime.now().difference(_lastTouch) < const Duration(minutes: 1);

  /// Every tap/scroll: marks activity; tells the server at most once a
  /// minute so a long form doesn't hit the idle lock.
  void touch() {
    _lastTouch = DateTime.now();
    if (!enabled || state != 'unlocked') return;
    if (DateTime.now().difference(_lastBeat) < const Duration(minutes: 1)) return;
    _lastBeat = DateTime.now();
    ApiClient.dio.post('/auth/app-lock/heartbeat').then((r) {
      if (r.data is Map) {
        status = Map<String, dynamic>.from(r.data as Map);
        if (mustShow) notifyListeners();
      }
    }).catchError((_) => null);
  }

  // ── Fingerprint ──────────────────────────────────────────────────────────

  Future<bool> biometricAvailable() async {
    try {
      return await _auth.isDeviceSupported() && (await _auth.getAvailableBiometrics()).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// Keep the app password for fingerprint unlock (after the user agreed).
  Future<void> enableBiometric(String password) async {
    await _storage.write(key: _pwKey, value: password);
    await _storage.write(key: _bioKey, value: '1');
    _bioEnabled = true;
    notifyListeners();
  }

  Future<void> disableBiometric() async {
    await _storage.delete(key: _pwKey);
    await _storage.delete(key: _bioKey);
    _bioEnabled = false;
    notifyListeners();
  }

  /// Fingerprint check, then unlock with the stored password. Returns null
  /// on success, or a message for the lock screen.
  Future<String?> unlockWithBiometric() async {
    final pw = await _storage.read(key: _pwKey);
    if (pw == null) {
      await disableBiometric();
      return 'Fingerprint unlock is not set up - enter your app password.';
    }
    bool ok;
    try {
      ok = await _auth.authenticate(
        localizedReason: 'Unlock Premnath ERP',
        biometricOnly: true,
      );
    } on LocalAuthException catch (e) {
      return _fingerprintMessage(e.code);
    } catch (_) {
      return 'Fingerprint could not be used right now. Enter your app password.';
    }
    if (!ok) return null; // cancelled - just stay on the lock screen
    try {
      await unlock(pw);
      return null;
    } on DioException catch (e) {
      if (e.response?.statusCode == 422) {
        // The app password was changed (on the portal) - forget the old one.
        await disableBiometric();
        return 'Your app password was changed. Enter the new one - fingerprint unlock will be set up again.';
      }
      return ApiClient.describe(e);
    }
  }

  /// Plain words for the phone's fingerprint result. Null = the person chose
  /// not to use it (cancel / back / "use password"): no message at all.
  static String? _fingerprintMessage(LocalAuthExceptionCode code) {
    switch (code) {
      case LocalAuthExceptionCode.userCanceled:
      case LocalAuthExceptionCode.systemCanceled:
      case LocalAuthExceptionCode.userRequestedFallback:
      case LocalAuthExceptionCode.authInProgress:
        return null;
      case LocalAuthExceptionCode.timeout:
        return 'The fingerprint check timed out. Tap "Unlock with fingerprint" to try again, or enter your app password.';
      case LocalAuthExceptionCode.temporaryLockout:
        return 'Too many fingerprint tries. Wait 30 seconds and try again, or enter your app password.';
      case LocalAuthExceptionCode.biometricLockout:
        return 'Fingerprint is blocked on this phone after too many tries. Unlock the phone with its PIN once, or enter your app password.';
      case LocalAuthExceptionCode.noBiometricsEnrolled:
      case LocalAuthExceptionCode.noCredentialsSet:
        return 'No fingerprint is saved on this phone. Add one in the phone\'s Settings, or enter your app password.';
      case LocalAuthExceptionCode.noBiometricHardware:
        return 'This phone has no fingerprint sensor. Enter your app password.';
      case LocalAuthExceptionCode.biometricHardwareTemporarilyUnavailable:
        return 'The fingerprint sensor is busy. Try again in a moment, or enter your app password.';
      default:
        return 'Fingerprint could not be used right now. Enter your app password.';
    }
  }

  /// Forget everything on logout.
  Future<void> reset() async {
    status = const {};
    lockMessage = null;
    await disableBiometric();
  }
}
