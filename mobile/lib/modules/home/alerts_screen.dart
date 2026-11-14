import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import '../../record_router.dart';
import 'alert_links.dart';
import 'home_common.dart';

/// Alerts - the portal's notification bell (NotificationBell.tsx): the last
/// 30 notifications newest first, unread ones highlighted, "Mark all read",
/// the On/Off switch for bell + Teams alerts. Tapping one marks it read and
/// opens its detail.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<Json> _rows = const [];
  int _unread = 0;
  bool _onlyUnread = false;
  bool _savingPref = false;

  bool get _enabled => Perm.user['notifications_enabled'] != false;

  Future<List<Json>> _load() async {
    final results = await Future.wait([
      Api.get('/notifications'),
      Api.get('/notifications/unread-count'),
    ]);
    final rows = rowsOf(results[0]);
    final c = results[1];
    _rows = rows;
    _unread = c is Map ? asInt(c['count']) : rows.where((n) => n['is_read'] != true).length;
    if (mounted) setState(() {});
    return rows;
  }

  Future<void> _markAllRead() async {
    final ok = await runAction(context, () => Api.patch('/notifications/read-all'), success: 'All notifications marked as read.');
    if (!ok || !mounted) return;
    setState(() {
      for (final n in _rows) {
        n['is_read'] = true;
      }
      _unread = 0;
    });
  }

  Future<void> _togglePref() async {
    if (_savingPref) return;
    setState(() => _savingPref = true);
    final next = !_enabled;
    await runAction(context, () async {
      final r = await Api.patch('/notifications/preferences', data: {'enabled': next});
      final user = Perm.user;
      // The signed-in user map is the app's copy of /auth/me - keep it in step.
      if (user.isNotEmpty) {
        user['notifications_enabled'] = r is Map ? r['notifications_enabled'] ?? next : next;
      }
    }, success: next ? 'Notifications turned on.' : 'Notifications turned off.');
    if (mounted) setState(() => _savingPref = false);
  }

  Future<void> _markRead(Json n) async {
    if (n['is_read'] == true) return;
    try {
      await Api.patch('/notifications/${n['id']}/read');
      if (mounted) {
        setState(() {
          n['is_read'] = true;
          _unread = (_unread - 1).clamp(0, 1 << 30);
        });
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  /// Tap = the portal bell's click: mark read and open the record. Alerts
  /// without a screen in the app open their detail instead.
  Future<void> _open(Json n) async {
    await _markRead(n);
    if (!mounted) return;
    final link = alertLink(n);
    if (link != null) {
      var opened = false;
      final ok = await runAction(context, () async => opened = await openPortalLink(context, link));
      // Opened, or the reason it could not open was shown: stay on the list.
      if (opened || !ok || !mounted) return;
    }
    openScreen(context, AlertDetailScreen(notification: n));
  }

  Future<void> _details(Json n) async {
    await _markRead(n);
    if (mounted) openScreen(context, AlertDetailScreen(notification: n));
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Notifications',
      actions: [
        if (_unread > 0)
          TextButton(onPressed: _markAllRead, child: const Text('Mark all read')),
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(48, 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              foregroundColor: _enabled ? Brand.muted : const Color(0xFFA8A29E),
              side: const BorderSide(color: Brand.border),
            ),
            onPressed: _savingPref ? null : _togglePref,
            child: Text(_enabled ? 'On' : 'Off', semanticsLabel: _enabled ? 'Turn notifications off' : 'Turn notifications on'),
          ),
        ),
      ],
      body: Loaded<List<Json>>(
        load: _load,
        builder: (ctx, _, _) {
          final shown = _onlyUnread ? _rows.where((n) => n['is_read'] != true).toList() : _rows;
          return ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              if (!_enabled)
                const HintCard("Notifications are turned off. You won't receive new alerts here or in Teams until you turn them back on."),
              ChipBar(children: [
                CountChip('All', _rows.length, selected: !_onlyUnread, onTap: () => setState(() => _onlyUnread = false)),
                CountChip('Unread', _unread,
                    selected: _onlyUnread, onTap: () => setState(() => _onlyUnread = !_onlyUnread)),
              ]),
              if (shown.isEmpty)
                EmptyView(_onlyUnread ? 'No unread notifications.' : 'No notifications yet.',
                    icon: Icons.notifications_none_rounded)
              else
                for (final n in shown) _AlertTile(n: n, onTap: () => _open(n), onDetails: () => _details(n)),
            ],
          );
        },
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.n, required this.onTap, required this.onDetails});
  final Json n;
  final VoidCallback onTap;

  /// Info icon / long-press: the notification itself.
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context) {
    final unread = n['is_read'] != true;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Material(
        color: unread ? const Color(0x0AF4713B) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: unread ? Brand.primary.withValues(alpha: 0.35) : Brand.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          onLongPress: onDetails,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 5, right: 10),
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                        shape: BoxShape.circle, color: unread ? Brand.primary : Colors.transparent),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(txt(n['title']),
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
                              color: Brand.heading)),
                      if ('${n['message'] ?? ''}'.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text('${n['message']}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13, color: Brand.muted)),
                      ],
                      if (n['created_at'] != null) ...[
                        const SizedBox(height: 4),
                        Text(fmtDateTime(n['created_at']),
                            style: const TextStyle(fontSize: 11, color: Color(0xFFA8A29E))),
                      ],
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Notification details',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.info_outline_rounded, size: 20, color: Brand.muted),
                  onPressed: onDetails,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One notification: title, message, when it came, read or not, and the
/// module it is about. "Open" opens the record in the app; only when the
/// app has no screen for it is the web portal offered.
class AlertDetailScreen extends StatefulWidget {
  const AlertDetailScreen({super.key, required this.notification});
  final Json notification;

  @override
  State<AlertDetailScreen> createState() => _AlertDetailScreenState();
}

class _AlertDetailScreenState extends State<AlertDetailScreen> {
  bool _busy = false;

  /// Set once the app found no screen for this record.
  bool _webOnly = false;

  Future<void> _openRecord(String link) async {
    setState(() => _busy = true);
    var opened = false;
    final ok = await runAction(context, () async => opened = await openPortalLink(context, link));
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok && !opened) _webOnly = true;
    });
    if (ok && !opened) {
      showSnack(context, 'This page is not in the app yet - open it in the web portal.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.notification;
    final link = alertLink(n);
    final module = moduleOfLink(link);
    return SubPage(
      title: 'Notification',
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          DetailSection(
            txt(n['title']),
            children: [
              if ('${n['message'] ?? ''}'.isNotEmpty) FieldRow('Message', n['message']),
              FieldRow('Received', fmtDateTime(n['created_at'])),
              FieldRow('Status', StatusBadge(n['is_read'] == true ? 'Read' : 'Unread',
                  color: n['is_read'] == true ? Brand.muted : Brand.primaryActive)),
              if (module != null) FieldRow('Related to', module),
            ],
          ),
          if (link == null)
            const HintCard('This notification is for your information only - there is no record to open.'),
        ],
      ),
      bottom: link == null
          ? null
          : _webOnly
              ? OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                  icon: const Icon(Icons.open_in_new_rounded),
                  label: const Text('Open in web portal'),
                  onPressed: () => runAction(context, () => Files.openInPortal(link)),
                )
              : FilledButton.icon(
                  icon: const Icon(Icons.arrow_forward_rounded),
                  label: const Text('Open'),
                  onPressed: _busy ? null : () => _openRecord(link),
                ),
    );
  }
}
