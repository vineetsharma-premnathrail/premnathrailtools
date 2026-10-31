/// Build-time settings, passed with `--dart-define-from-file=env/dev.json`
/// (copy env/dev.example.json). Nothing environment-specific lives in source.
class AppConfig {
  /// The emulator reaches the laptop's localhost as 10.0.2.2.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000/api/v1',
  );

  /// Same Azure app registration the portal and the Teams app use.
  static const azureClientId = String.fromEnvironment('AZURE_CLIENT_ID');

  /// `api://<host>/<client id>/access_as_user` — the backend's /auth/teams-token
  /// accepts any token our tenant issued for this audience.
  static const apiScope = String.fromEnvironment('API_SCOPE');

  /// `msauth://<package name>/<url-encoded signature hash>`, registered in Azure
  /// under Authentication → Android.
  static const androidRedirectUri = String.fromEnvironment('ANDROID_REDIRECT_URI');

  static List<String> get missingSettings => [
        if (azureClientId.isEmpty) 'AZURE_CLIENT_ID',
        if (apiScope.isEmpty) 'API_SCOPE',
        if (androidRedirectUri.isEmpty) 'ANDROID_REDIRECT_URI',
      ];
}
