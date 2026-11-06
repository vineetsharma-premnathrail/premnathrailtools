import '../auth/auth_service.dart';

/// Client mirror of the portal's frontend/src/lib/permissions.ts. Only hides
/// what the server would refuse anyway - the server still checks everything.
class Perm {
  Perm._();

  static Map<String, dynamic> get user => AuthService.instance.user ?? const {};

  static bool get isAdmin => user['role'] == 'admin' || user['is_azure_admin'] == true;

  static int? get userId => user['id'] is int ? user['id'] as int : null;

  static List<String> get _perms =>
      (user['permissions'] is List) ? (user['permissions'] as List).whereType<String>().toList() : const [];

  /// `can('store', 'issues', 'approve')` - module › tab › action.
  static bool can(String module, String tab, String action) =>
      isAdmin || _perms.contains('$module:$tab:$action');

  /// Feature inside a tab: `canFeature('crm', 'inquiries_tenders', 'quotations', 'create')`.
  static bool canFeature(String module, String tab, String feature, String action) =>
      can(module, '$tab.$feature', action);

  /// Any action on a tab at all (tab visible).
  static bool canView(String module, String tab) => can(module, tab, 'view');

  /// Holds the app (module) - same as the portal's `user.apps`.
  static bool hasApp(String app) =>
      isAdmin || ((user['apps'] is List) && (user['apps'] as List).contains(app));
}
