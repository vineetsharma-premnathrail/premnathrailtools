import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api.dart';
import '../theme.dart';
import 'format.dart';

// ── States ───────────────────────────────────────────────────────────────────

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) =>
      const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
}

/// Real error text (reason + what to do) with Retry.
class ErrorView extends StatelessWidget {
  const ErrorView(this.error, {super.key, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ErrorBanner(error is String ? error as String : ApiClient.describe(error)),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                  onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: const Text('Retry')),
            ],
          ],
        ),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Brand.dangerSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Brand.danger.withValues(alpha: 0.3)),
      ),
      child: Text(message, style: const TextStyle(color: Brand.danger, fontSize: 14)),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView(this.message, {super.key, this.icon = Icons.inbox_outlined});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Brand.muted),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Brand.muted)),
          ],
        ),
      ),
    );
  }
}

// ── Text bits ────────────────────────────────────────────────────────────────

/// Small caps section label ("YOUR APPLICATIONS").
class Caps extends StatelessWidget {
  const Caps(this.text, {super.key, this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(),
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.9, color: color));
}

/// Page title block under the module tabs: title, subtitle, actions.
class PageHeader extends StatelessWidget {
  const PageHeader(this.title, {super.key, this.subtitle, this.actions = const []});
  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: const TextStyle(fontSize: 13, color: Brand.muted)),
                ],
              ],
            ),
          ),
          ...actions,
        ],
      ),
    );
  }
}

// ── Status badge ─────────────────────────────────────────────────────────────

/// Coloured pill for a status value; colour picked from the word, like the
/// portal's badges (approved/done = green, pending/draft = amber, rejected/
/// cancelled = red, in progress = blue, else grey).
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, this.color});
  final Object? status;
  final Color? color;

  static Color colorFor(String s) {
    final v = s.toLowerCase();
    bool has(List<String> words) => words.any(v.contains);
    if (has(['reject', 'cancel', 'fail', 'overdue', 'lost', 'block', 'breakdown', 'expired', 'short'])) {
      return const Color(0xFFDC2626);
    }
    if (has(['approved', 'complete', 'done', 'closed', 'won', 'paid', 'received', 'active', 'pass', 'accepted', 'resolved', 'issued', 'posted', 'delivered'])) {
      return const Color(0xFF16A34A);
    }
    if (has(['pending', 'draft', 'await', 'submitted', 'review', 'hold', 'open', 'new', 'waiting', 'partial'])) {
      return const Color(0xFFD97706);
    }
    if (has(['progress', 'running', 'assigned', 'scheduled', 'sent', 'ordered'])) {
      return const Color(0xFF2563EB);
    }
    return const Color(0xFF64748B);
  }

  @override
  Widget build(BuildContext context) {
    final text = humanize(status);
    final c = color ?? colorFor(text);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(text, style: TextStyle(color: c, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}

// ── Cards and detail sections ────────────────────────────────────────────────

/// One record in a list - the phone version of a portal table row.
class RecordCard extends StatelessWidget {
  const RecordCard({
    super.key,
    required this.title,
    this.code,
    this.subtitle,
    this.status,
    this.meta = const [],
    this.trailing,
    this.onTap,
  });

  final String title;

  /// Record number (PR-2026-0012, SR-…) shown above the title.
  final String? code;
  final String? subtitle;
  final Object? status;

  /// Label → value pairs shown in a compact grid.
  final List<(String, String)> meta;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (code != null && code!.isNotEmpty)
                            Text(code!,
                                style: const TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                          Text(title,
                              style: const TextStyle(
                                  fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading)),
                          if (subtitle != null && subtitle!.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(subtitle!, style: const TextStyle(fontSize: 13, color: Brand.muted)),
                            ),
                        ],
                      ),
                    ),
                    if (status != null) ...[const SizedBox(width: 8), StatusBadge(status)],
                    ?trailing,
                  ],
                ),
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 16,
                    runSpacing: 6,
                    children: [
                      for (final (label, value) in meta)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
                            Text(value,
                                style: const TextStyle(
                                    fontSize: 13, fontWeight: FontWeight.w500, color: Brand.body)),
                          ],
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A titled card of fields on a detail screen.
class DetailSection extends StatelessWidget {
  const DetailSection(this.title, {super.key, required this.children, this.action});
  final String title;
  final List<Widget> children;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(title,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                  ),
                  ?action,
                ],
              ),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Label above value, inside a [DetailSection].
class FieldRow extends StatelessWidget {
  const FieldRow(this.label, this.value, {super.key});
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          const SizedBox(height: 1),
          value is Widget
              ? value as Widget
              : SelectableText(txt(value), style: const TextStyle(fontSize: 14, color: Brand.body)),
        ],
      ),
    );
  }
}

/// Clickable count chip that filters its list (memory: clickable counts).
class CountChip extends StatelessWidget {
  const CountChip(this.label, this.count, {super.key, this.selected = false, this.onTap, this.color});
  final String label;
  final Object? count;
  final bool selected;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Brand.primary;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: selected ? c : Colors.white,
        shape: StadiumBorder(side: BorderSide(color: selected ? c : Brand.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Text('$label  ${count ?? ''}'.trim(),
                style: TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600, color: selected ? Colors.white : Brand.body)),
          ),
        ),
      ),
    );
  }
}

// ── Lists ────────────────────────────────────────────────────────────────────

/// Loads rows and shows them with pull-to-refresh, search, paging and the
/// loading / error / empty states. The phone version of a portal list page.
///
///     ApiListView(
///       load: (page, search) => Api.list('/p2p/requisitions',
///           query: {'page': page, 'page_size': 30, 'search': search}),
///       itemBuilder: (ctx, row, reload) => RecordCard(...),
///       emptyText: 'No requisitions yet.',
///     )
class ApiListView extends StatefulWidget {
  const ApiListView({
    super.key,
    required this.load,
    required this.itemBuilder,
    this.emptyText = 'Nothing here yet.',
    this.searchHint,
    this.header,
    this.paged = false,
    this.pageSize = 30,
  });

  /// page is 1-based; search is '' when no search box or empty.
  final Future<ApiPage> Function(int page, String search) load;
  final Widget Function(BuildContext context, Json row, VoidCallback reload) itemBuilder;
  final String emptyText;

  /// Shows a search box when set.
  final String? searchHint;

  /// Above the rows (count chips, filters) - scrolls with the list.
  final Widget? header;

  /// Asks for the next page when the end is reached.
  final bool paged;
  final int pageSize;

  @override
  State<ApiListView> createState() => ApiListViewState();
}

class ApiListViewState extends State<ApiListView> {
  final _rows = <Json>[];
  Object? _error;
  bool _loading = true;
  bool _more = false;
  int _page = 1;
  String _search = '';
  Timer? _debounce;
  int _token = 0;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  /// Reload from page 1 (call after a create/edit).
  Future<void> reload() async {
    final t = ++_token;
    setState(() {
      _loading = true;
      _error = null;
      _page = 1;
    });
    try {
      final p = await widget.load(1, _search);
      if (!mounted || t != _token) return;
      setState(() {
        _rows
          ..clear()
          ..addAll(p.rows);
        _more = widget.paged && p.rows.length >= widget.pageSize &&
            (p.total == null || _rows.length < p.total!);
        _loading = false;
      });
    } catch (e) {
      if (!mounted || t != _token) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (!_more || _loading) return;
    final t = _token;
    _more = false;
    try {
      final p = await widget.load(_page + 1, _search);
      if (!mounted || t != _token) return;
      setState(() {
        _page++;
        _rows.addAll(p.rows);
        _more = p.rows.length >= widget.pageSize && (p.total == null || _rows.length < p.total!);
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _search = v.trim();
      reload();
    });
  }

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[
      if (widget.searchHint != null)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: SearchField(hint: widget.searchHint!, onChanged: _onSearch),
        ),
      ?widget.header,
    ];
    Widget body;
    if (_loading && _rows.isEmpty) {
      body = ListView(children: [...children, const LoadingView()]);
    } else if (_error != null && _rows.isEmpty) {
      body = ListView(children: [...children, ErrorView(_error!, onRetry: reload)]);
    } else if (_rows.isEmpty) {
      body = ListView(children: [...children, EmptyView(widget.emptyText)]);
    } else {
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _loadMore();
          return false;
        },
        child: ListView.builder(
          padding: const EdgeInsets.only(bottom: 88),
          itemCount: children.length + _rows.length + (_more ? 1 : 0),
          itemBuilder: (ctx, i) {
            if (i < children.length) return children[i];
            final r = i - children.length;
            if (r >= _rows.length) return const LoadingView();
            return widget.itemBuilder(ctx, _rows[r], reload);
          },
        ),
      );
    }
    return RefreshIndicator(onRefresh: reload, child: body);
  }
}

class SearchField extends StatelessWidget {
  const SearchField({super.key, required this.hint, required this.onChanged});
  final String hint;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded),
        isDense: true,
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Brand.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Brand.border)),
      ),
    );
  }
}

/// Loads one record (detail screens) with loading / error / retry.
class ApiLoader<T> extends StatefulWidget {
  const ApiLoader({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, VoidCallback reload) builder;

  @override
  State<ApiLoader<T>> createState() => _ApiLoaderState<T>();
}

class _ApiLoaderState<T> extends State<ApiLoader<T>> {
  late Future<T> _future = widget.load();

  void _reload() => setState(() => _future = widget.load());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _future,
      builder: (ctx, s) {
        if (s.connectionState != ConnectionState.done) return const LoadingView();
        if (s.hasError) return ErrorView(s.error!, onRetry: _reload);
        return RefreshIndicator(
          onRefresh: () async => _reload(),
          child: widget.builder(ctx, s.data as T, _reload),
        );
      },
    );
  }
}

// ── Dialogs and messages ─────────────────────────────────────────────────────

/// Yes/No question (the portal's ConfirmDialog). True when confirmed.
Future<bool> confirmDialog(BuildContext context,
    {required String title, required String message, String confirmLabel = 'Confirm', bool danger = false}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Brand.danger, minimumSize: const Size(88, 40)) :
              FilledButton.styleFrom(minimumSize: const Size(88, 40)),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok == true;
}

/// Asks for a reason/remark (the portal's PromptDialog / ReasonSheet).
/// Null when cancelled.
Future<String?> promptDialog(BuildContext context,
    {required String title, String? message, String label = 'Reason', bool required = true, String confirmLabel = 'Submit'}) async {
  final ctrl = TextEditingController();
  String? error;
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (message != null) ...[Text(message), const SizedBox(height: 12)],
            TextField(
              controller: ctrl,
              maxLines: 3,
              autofocus: true,
              decoration: InputDecoration(labelText: label, errorText: error, border: const OutlineInputBorder()),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
            onPressed: () {
              final v = ctrl.text.trim();
              if (required && v.isEmpty) {
                setS(() => error = 'Enter the ${label.toLowerCase()} - it is saved with the record.');
                return;
              }
              Navigator.pop(ctx, v);
            },
            child: Text(confirmLabel),
          ),
        ],
      ),
    ),
  );
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Brand.danger : null,
      behavior: SnackBarBehavior.floating,
    ));
}

/// Runs a server action with a snack for the result; true when it worked.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (context.mounted && success != null) showSnack(context, success);
    return true;
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return false;
  }
}

/// Opens a screen; the Future completes when it closes (reload lists then).
Future<T?> openScreen<T>(BuildContext context, Widget screen) =>
    Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => screen));
