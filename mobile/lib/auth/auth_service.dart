import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:msal_auth/msal_auth.dart';

import '../api/api_client.dart';
import '../config.dart';

/// Microsoft sign-in (MSAL) → portal session.
///
/// MSAL gives a token for the portal's Azure app; the backend's
/// /auth/teams-token checks it (signature, our tenant, company domain, user
/// active / not exited in HR) and returns the portal session token, exactly
/// like Teams single sign-on. The phone keeps the Microsoft account, so later
/// app starts sign in silently.
class AuthService extends ChangeNotifier {
  AuthService._();
  static final AuthService instance = AuthService._();

  static const _storage = FlutterSecureStorage();
  static const _sessionKey = 'session_token';

  SingleAccountPca? _pca;
  String? _sessionToken;
  Map<String, dynamic>? _user;
  Future<bool>? _renewing;

  String? get sessionToken => _sessionToken;
  Map<String, dynamic>? get user => _user;
  bool get isSignedIn => _user != null;

  Future<SingleAccountPca> _client() async {
    return _pca ??= await SingleAccountPca.create(
      clientId: AppConfig.azureClientId,
      androidConfig: AndroidConfig(
        configFilePath: 'assets/msal_config.json',
        redirectUri: AppConfig.androidRedirectUri,
      ),
    );
  }

  /// App start: reuse the account already signed in on this phone, no prompt.
  Future<void> restore() async {
    if (AppConfig.missingSettings.isNotEmpty) return;
    _sessionToken = await _storage.read(key: _sessionKey);
    try {
      final result = await (await _client()).acquireTokenSilent(scopes: [AppConfig.apiScope]);
      await _startSession(result.accessToken);
    } catch (_) {
      await _clearLocal();
    }
  }

  /// Login button. Reuses the Microsoft account already on this phone when it
  /// still works; otherwise forgets it first - MSAL single-account mode refuses
  /// an interactive login while a different (or stale) account is cached
  /// ("signed in account does not match the provided account").
  Future<void> signIn() async {
    final pca = await _client();
    try {
      final result = await pca.acquireTokenSilent(scopes: [AppConfig.apiScope]);
      await _startSession(result.accessToken);
      return;
    } on MsalException catch (_) {
      // No usable cached account - fall through to the interactive login.
    }
    try {
      await pca.signOut();
    } on MsalException catch (_) {}
    final result = await pca.acquireToken(
      scopes: [AppConfig.apiScope],
      prompt: Prompt.selectAccount,
    );
    await _startSession(result.accessToken);
  }

  /// Called by the API client on a 401. Concurrent callers share one renewal.
  Future<bool> renew() {
    return _renewing ??= () async {
      try {
        final result = await (await _client()).acquireTokenSilent(scopes: [AppConfig.apiScope]);
        await _startSession(result.accessToken);
        return true;
      } catch (_) {
        await _clearLocal();
        return false;
      } finally {
        _renewing = null;
      }
    }();
  }

  Future<void> signOut() async {
    try {
      await ApiClient.dio.post('/auth/logout');
    } catch (_) {
      // Server session expires on its own; local sign-out must still happen.
    }
    try {
      await (await _client()).signOut();
    } on MsalException catch (_) {}
    await _clearLocal();
  }

  Future<void> _startSession(String microsoftToken) async {
    final res = await ApiClient.dio.post('/auth/teams-token', data: {
      'token': microsoftToken,
      // Continue (rotate) the previous session instead of opening a new one.
      'previous_token': _sessionToken ?? '',
    });
    _sessionToken = res.data['access_token'] as String;
    await _storage.write(key: _sessionKey, value: _sessionToken);
    final me = await ApiClient.dio.get('/auth/me');
    _user = Map<String, dynamic>.from(me.data as Map);
    notifyListeners();
  }

  Future<void> _clearLocal() async {
    _sessionToken = null;
    _user = null;
    await _storage.delete(key: _sessionKey);
    notifyListeners();
  }
}
