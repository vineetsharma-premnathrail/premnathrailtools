import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Organization › Security & Sessions - copy of
/// frontend/src/app/dashboard/organization/security/page.tsx.
class OrgSecurityTab extends StatefulWidget {
  const OrgSecurityTab({super.key});

  @override
  State<OrgSecurityTab> createState() => _OrgSecurityTabState();
}

const _eventLabel = {
  'login': 'Signed in',
  'login_failed': 'Blocked',
  'logout': 'Signed out',
  'session_revoked': 'Signed out by admin',
};
const _eventColor = {
  'login': Color(0xFF16A34A),
  'login_failed': Color(0xFFDC2626),
  'logout': Color(0xFF78716C),
  'session_revoked': Color(0xFFF59E0B),
};

/// "Chrome on Windows" from a user agent (portal device()).
String _deviceOf(Object? uaRaw) {
  final ua = uaRaw?.toString() ?? '';
  if (ua.isEmpty) return '—';
  final b = ua.contains('Edg/')
      ? 'Edge'
      : ua.contains('Chrome/')
          ? 'Chrome'
          : ua.contains('Firefox/')
              ? 'Firefox'
              : ua.contains('Safari/')
                  ? 'Safari'
                  : ua.contains('Teams')
                      ? 'Teams'
                      : (ua.contains('Dart') ? 'Android app' : 'Browser');
  final os = ua.contains('Windows')
      ? 'Windows'
      : ua.contains('Android')
          ? 'Android'
          : RegExp('iPhone|iPad').hasMatch(ua)
              ? 'iOS'
              : ua.contains('Mac OS')
                  ? 'macOS'
                  : ua.contains('Linux')
                      ? 'Linux'
                      : '';
  return os.isEmpty ? b : '$b on $os';
}

// (key, label, help, min, max)
const _numFields = <(String, String, String, int, int)>[
  ('access_token_minutes', 'Access token (minutes)', 'How long a page session is trusted before it silently renews.', 5, 120),
  ('refresh_token_days', 'Stay signed in (days)',
      'Days without opening the portal before the session ends. Every visit restarts the count; after it ends the portal signs the user back in with Microsoft on its own.',
      1, 30),
  ('idle_timeout_minutes', 'Idle sign-out (minutes)', '0 = off. Signs out a session nobody has used for this long.', 0, 10080),
  ('max_sessions_per_user', 'Devices per user', '0 = unlimited. Signing in on one more device signs out the oldest.', 0, 20),
];
const _lockFields = <(String, String, String, int, int)>[
  ('app_lock_idle_minutes', 'Lock after idle (minutes)', 'No mouse / keyboard for this long locks the portal.', 1, 480),
  ('app_password_min_length', 'Minimum length', 'Shortest app password allowed.', 4, 32),
];

class _OrgSecurityTabState extends State<OrgSecurityTab> {
  Json? _values;
  Json? _saved;
  Json? _defaults;
  String? _settingsError;
  List<Json>? _sessions;
  String? _sessionsError;
  List<Json>? _events;
  String? _eventsError;
  bool _failedOnly = false;
  int _formGen = 0;
  int _eventsToken = 0;

  bool get _canEdit => orgCan('security', 'edit');

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _loadSessions();
    _loadEvents();
  }

  Future<void> _loadSettings() async {
    try {
      final r = jsonMap(await Api.get('/organization/security/settings'));
      if (!mounted) return;
      setState(() {
        _values = jsonMap(r['values']);
        _saved = Map.of(_values!);
        _defaults = jsonMap(r['defaults']);
        _settingsError = null;
        _formGen++;
      });
    } catch (e) {
      if (mounted) setState(() => _settingsError = 'Could not load security settings: ${ApiClient.describe(e)}');
    }
  }

  Future<void> _loadSessions() async {
    try {
      final p = await Api.list('/organization/security/sessions');
      if (mounted) {
        setState(() {
          _sessions = p.rows;
          _sessionsError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _sessionsError = 'Could not load sessions: ${ApiClient.describe(e)}');
    }
  }

  Future<void> _loadEvents() async {
    final t = ++_eventsToken;
    setState(() {
      _events = null;
      _eventsError = null;
    });
    try {
      final p = await Api.list('/organization/security/sign-ins', query: {'failed_only': _failedOnly, 'limit': 1000});
      if (mounted && t == _eventsToken) setState(() => _events = p.rows);
    } catch (e) {
      if (mounted && t == _eventsToken) setState(() => _eventsError = ApiClient.describe(e));
    }
  }

  Future<void> _refresh() async {
    await Future.wait([_loadSettings(), _loadSessions()]);
    _loadEvents();
  }

  bool get _dirty {
    final v = _values, s = _saved;
    if (v == null || s == null) return false;
    for (final k in {...v.keys, ...s.keys}) {
      if ('${v[k]}' != '${s[k]}') return true;
    }
    return false;
  }

  Future<void> _save() async {
    try {
      final r = jsonMap(await Api.put('/organization/security/settings', data: _values));
      if (!mounted) return;
      setState(() {
        _values = jsonMap(r['values']);
        _saved = Map.of(_values!);
        _formGen++;
      });
      showSnack(context, 'Security settings saved. New lifetimes apply from each user’s next sign-in or token refresh.');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not save security settings: ${ApiClient.describe(e)}', error: true);
    }
  }

  Future<void> _revoke(Json s) async {
    final ok = await confirmDialog(context,
        title: 'Sign out this session?',
        message: '${str(s['user_name'])} will be signed out on ${_deviceOf(s['user_agent'])} at their next request.',
        confirmLabel: 'Sign out',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/organization/security/sessions/${s['id']}/revoke'),
        success: 'Session signed out.')) {
      _loadSessions();
    }
  }

  Future<void> _revokeAll(Json s) async {
    final ok = await confirmDialog(context,
        title: 'Sign out everywhere?',
        message: 'Sign ${str(s['user_name'])} out of every device and browser?',
        confirmLabel: 'Sign out everywhere',
        danger: true);
    if (!ok || !mounted) return;
    try {
      final r = jsonMap(await Api.post('/organization/security/users/${s['user_id']}/revoke-all'));
      if (!mounted) return;
      showSnack(context,
          '${str(s['user_name'])} was signed out of ${str(r['revoked'])} session(s). They stay signed out until they sign in again.');
      _loadSessions();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not sign the user out: ${ApiClient.describe(e)}', error: true);
    }
  }

  Future<void> _reset(Json s) async {
    final ok = await confirmDialog(context,
        title: 'Email a temporary app password?',
        message: '${str(s['user_name'])} gets a one-time temporary password at ${str(s['user_email'])} (valid 15 minutes) '
            'to set a new app password. You won\'t see it. Their current app password keeps working until they change it.',
        confirmLabel: 'Send email');
    if (!ok || !mounted) return;
    try {
      final r = jsonMap(await Api.post('/organization/security/users/${s['user_id']}/app-password-reset'));
      if (!mounted) return;
      showSnack(context,
          'A one-time temporary app password was emailed to ${str(r['sent_to'])}. ${str(s['user_name'])} enters it on the lock screen and sets a new app password.');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not send the app password reset: ${ApiClient.describe(e)}', error: true);
    }
  }

  Widget _numField((String, String, String, int, int) f) {
    final (k, label, help, min, max) = f;
    final v = _values!;
    final d = _defaults?[k];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        AppTextField(
          key: ValueKey('$k-$_formGen'),
          label: label,
          initialValue: v[k] == null ? '' : '${v[k]}',
          hint: d == null ? null : '$d',
          enabled: _canEdit,
          keyboardType: TextInputType.number,
          onChanged: (s) => setState(() => v[k] = int.tryParse(s.trim()) ?? s.trim()),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4, left: 2),
          child: Text('$help${d != null && '${v[k]}' != '$d' ? ' Default $d.' : ''} ($min–$max)',
              style: const TextStyle(fontSize: 12, color: Color(0xFF57534E))),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final v = _values;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 40),
        children: [
          const PageHeader('Security & Sessions'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: const Color(0x0F2563EB), borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.border)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text(
                    'Sign-in uses Microsoft Entra ID. Multi-factor authentication, password rules and account lockout are set in Entra, not here. '
                    'Deactivating a user in Organization › Users also blocks portal sign-in.',
                    style: TextStyle(fontSize: 13, color: Color(0xFF1E3A8A))),
                const SizedBox(height: 8),
                PillButton('Open Entra admin', icon: Icons.open_in_new_rounded, onPressed: () async {
                  try {
                    await Files.openUrl('https://entra.microsoft.com');
                  } catch (e) {
                    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
                  }
                }),
              ]),
            ),
          ),
          if (_settingsError != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_settingsError!)),
          if (v != null)
            DetailSection('Session policy', children: [
              for (final f in _numFields) _numField(f),
              const SizedBox(height: 8),
              const Text('App password lock',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
              const Padding(
                padding: EdgeInsets.only(top: 4, bottom: 8),
                child: Text(
                    'Laptops share one Windows / Microsoft password, so the portal asks each user\'s own app password after every sign-in and after idle time. '
                    'Users set it themselves at their first sign-in and reset it by email (a one-time temporary password). 5 wrong tries lock it for 15 minutes.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF57534E))),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('App password lock: ${v['app_lock_enabled'] == true ? 'On' : 'Off'}'),
                subtitle: const Text('Off = Microsoft sign-in alone opens the portal.'),
                value: v['app_lock_enabled'] == true,
                onChanged: _canEdit ? (b) => setState(() => v['app_lock_enabled'] = b) : null,
              ),
              for (final f in _lockFields) _numField(f),
              if (_canEdit)
                Row(children: [
                  if (_dirty)
                    const Expanded(
                        child: Text('Unsaved changes',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFC2410C))))
                  else
                    const Spacer(),
                  if (_dirty)
                    TextButton(
                        onPressed: () => setState(() {
                              _values = Map.of(_saved!);
                              _formGen++;
                            }),
                        child: const Text('Discard')),
                  FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size(110, 40)),
                      onPressed: _dirty ? _save : null,
                      child: const Text('Save policy')),
                ]),
            ])
          else if (_settingsError == null)
            const LoadingView(),
          DetailSection('Signed-in sessions (${_sessions?.length ?? 0})', children: [
            if (_sessionsError != null) ErrorBanner(_sessionsError!),
            if (_sessions == null && _sessionsError == null) const LoadingView(),
            if (_sessions != null && _sessions!.isEmpty)
              const Text('No live sessions.', style: TextStyle(color: Color(0xFF57534E))),
            for (final s in _sessions ?? const <Json>[]) _sessionTile(s),
          ]),
          DetailSection('Sign-in activity',
              action: TextButton(
                style: TextButton.styleFrom(foregroundColor: _failedOnly ? Brand.danger : Brand.body),
                onPressed: () {
                  setState(() => _failedOnly = !_failedOnly);
                  _loadEvents();
                },
                child: Text(_failedOnly ? 'Showing blocked only' : 'Show blocked only'),
              ),
              children: [
                if (_eventsError != null) ...[
                  ErrorBanner('The sign-in log could not be loaded: $_eventsError'),
                  TextButton(onPressed: _loadEvents, child: const Text('Try again')),
                ] else if (_events == null)
                  const LoadingView()
                else if (_events!.isEmpty)
                  const Text('No sign-in events recorded yet.', style: TextStyle(color: Brand.muted))
                else ...[
                  Text('${_events!.length} events', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  for (final e in _events!) _eventTile(e),
                ],
              ]),
        ],
      ),
    );
  }

  Widget _sessionTile(Json s) {
    final lock = s['app_lock_state'] == 'unlocked'
        ? 'Unlocked'
        : s['app_lock_state'] == 'reset'
            ? 'Resetting'
            : 'Locked';
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x14000000)))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(str(s['user_name']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
        Text(str(s['user_email']), style: const TextStyle(fontSize: 12, color: Color(0xFF57534E))),
        const SizedBox(height: 4),
        Wrap(spacing: 14, runSpacing: 4, children: [
          _kv('Device', _deviceOf(s['user_agent'])),
          _kv('IP address', txt(s['ip_address'])),
          _kv('Signed in / renewed', fmtDateTime(s['created_at'])),
          _kv('Expires', fmtDateTime(s['expires_at'])),
          _kv('App lock', lock),
        ]),
        if (_canEdit)
          Wrap(spacing: 4, children: [
            TextButton(
                style: TextButton.styleFrom(foregroundColor: const Color(0xFFDC2626), visualDensity: VisualDensity.compact),
                onPressed: () => _revoke(s),
                child: const Text('Sign out')),
            TextButton(
                style: TextButton.styleFrom(foregroundColor: Brand.body, visualDensity: VisualDensity.compact),
                onPressed: () => _revokeAll(s),
                child: const Text('Everywhere')),
            TextButton(
                style: TextButton.styleFrom(foregroundColor: const Color(0xFFC2410C), visualDensity: VisualDensity.compact),
                onPressed: () => _reset(s),
                child: const Text('Reset app password')),
          ]),
      ]),
    );
  }

  Widget _eventTile(Json e) {
    final a = str(e['action']);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x14000000)))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(_eventLabel[a] ?? a, style: TextStyle(fontWeight: FontWeight.w600, color: _eventColor[a] ?? Brand.body)),
          const Spacer(),
          Text(fmtDateTime(e['created_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ]),
        if (str(e['summary']).isNotEmpty) Text(str(e['summary']), style: const TextStyle(fontSize: 12.5, color: Brand.body)),
        Text('${txt(e['ip_address'])} · ${_deviceOf(e['user_agent'])}',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ]),
    );
  }

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(k, style: const TextStyle(fontSize: 11, color: Brand.muted)),
        Text(v, style: const TextStyle(fontSize: 12.5, color: Brand.body)),
      ]);
}
