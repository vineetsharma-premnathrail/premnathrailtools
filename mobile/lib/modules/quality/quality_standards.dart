import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _statusLabels = <String, String>{'active': 'Active', 'draft': 'Draft', 'obsolete': 'Obsolete'};
const _statusHex = <String, Color>{'active': Color(0xFF16A34A), 'draft': Color(0xFFF59E0B), 'obsolete': Color(0xFF78716C)};
const _statusOptions = [Option('draft', 'Draft'), Option('active', 'Active'), Option('obsolete', 'Obsolete')];

/// Quality Standards register (portal standards/page.tsx).
class StandardsTab extends StatefulWidget {
  const StandardsTab({super.key});

  @override
  State<StandardsTab> createState() => _StandardsTabState();
}

class _StandardsTabState extends State<StandardsTab> {
  String _status = '';
  final _listKey = GlobalKey<ApiListViewState>();

  Future<void> _new() async {
    final s = await _showStandardForm(context, null);
    if (s != null && mounted) {
      _listKey.currentState?.reload();
      openScreen(context, StandardDetailScreen(id: asInt(s['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          Perm.can('quality', 'standards', 'create') ? CreateFab(label: 'New Standard', onPressed: _new) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search by code, title, or category…',
        load: (page, search) async {
          final p = await Api.list('/quality/standards', query: {'status': _status});
          final q = search.toLowerCase();
          return ApiPage(q.isEmpty
              ? p.rows
              : p.rows
                  .where((s) => '${s['standard_code']} ${s['title']} ${s['category'] ?? ''}'.toLowerCase().contains(q))
                  .toList());
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Standards', subtitle: 'Quality Module'),
          FilterSelect(
            label: 'Status',
            allLabel: 'All statuses',
            value: _status,
            options: _statusLabels,
            onChanged: (v) {
              setState(() => _status = v);
              _listKey.currentState?.reload();
            },
          ),
        ]),
        emptyText: 'No standards found.',
        itemBuilder: (ctx, s, reload) => RecordCard(
          code: str(s['standard_code']),
          title: txt(s['title']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(_statusLabels, _statusHex, s['status'])),
          meta: [('Category', txt(s['category'])), ('Effective Date', fmtDate(s['effective_date']))],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => StandardDetailScreen(id: asInt(s['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

/// New / edit standard form; returns the saved standard.
Future<Json?> _showStandardForm(BuildContext context, Json? existing) async {
  final code = TextEditingController(text: str(existing?['standard_code']));
  final title = TextEditingController(text: str(existing?['title']));
  final category = TextEditingController(text: str(existing?['category']));
  final desc = TextEditingController(text: str(existing?['description']));
  var effective = parseDate(existing?['effective_date']);
  var status = str(existing?['status']).isEmpty ? 'draft' : str(existing?['status']);
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: existing == null ? 'New Standard' : 'Edit Standard',
    saveLabel: existing == null ? 'Save Standard' : 'Save changes',
    builder: (ctx, setS) => [
      const Caps('Standard details'),
      AppTextField(label: 'Standard Code', required: true, controller: code, hint: 'e.g. QMS-001'),
      AppTextField(label: 'Title', required: true, controller: title),
      AppTextField(label: 'Category', controller: category),
      AppTextField(label: 'Description', controller: desc, maxLines: 4),
      const Caps('Status'),
      AppSelect<String>(
        label: 'Status',
        value: status,
        clearable: false,
        options: _statusOptions,
        onChanged: (o) => setS(() => status = o?.value ?? status),
      ),
      DateField(label: 'Effective Date', value: effective, onChanged: (d) => setS(() => effective = d)),
    ],
    onSave: () async {
      if (code.text.trim().isEmpty) throw 'Standard code is required.';
      if (title.text.trim().isEmpty) throw 'Title is required.';
      final payload = {
        'standard_code': code.text.trim(),
        'title': title.text.trim(),
        'category': category.text.trim().isEmpty ? null : category.text.trim(),
        'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        'effective_date': effective == null ? null : apiDate(effective!),
        'status': status,
      };
      final r = existing == null
          ? await Api.post('/quality/standards', data: payload)
          : await Api.patch('/quality/standards/${existing['id']}', data: payload);
      saved = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? saved : null;
}

/// Standard detail (portal standards/[id]/page.tsx).
class StandardDetailScreen extends StatefulWidget {
  const StandardDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<StandardDetailScreen> createState() => _StandardDetailScreenState();
}

class _StandardDetailScreenState extends State<StandardDetailScreen> {
  Json? _s;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get('/quality/standards/${widget.id}');
      if (mounted) {
        setState(() {
          _s = Map<String, dynamic>.from(r as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _edit() async {
    final r = await _showStandardForm(context, _s);
    if (r != null && mounted) {
      setState(() => _s = r);
      showSnack(context, 'Standard saved.');
    }
  }

  Future<void> _delete() async {
    final s = _s!;
    final yes = await confirmDialog(context,
        title: 'Delete this Standard?',
        message: 'This permanently deletes "${s['standard_code']} — ${s['title']}". This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/quality/standards/${widget.id}'), success: 'Standard deleted.');
    if (ok && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    if (s == null) {
      return SubPage(
          title: 'Quality Standard', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final canEdit = Perm.can('quality', 'standards', 'edit');
    final canDel = qCanDelete('standards', s['created_by_id']);
    return SubPage(
      title: txt(s['standard_code']),
      bottom: canEdit || canDel
          ? BottomActions(children: [
              if (canDel) secondaryBtn('Delete standard', _delete, color: qRed, icon: Icons.delete_outline_rounded),
              if (canEdit) primaryBtn('Edit', _edit, icon: Icons.edit_outlined),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Quality · Standard · ${txt(s['title'])}'),
            DetailSection('Standard details', children: [
              FieldRow('Standard code', s['standard_code']),
              FieldRow('Title', s['title']),
              FieldRow('Category', s['category']),
              FieldRow('Effective date', fmtDate(s['effective_date'])),
              FieldRow('Status', Align(alignment: Alignment.centerLeft, child: qPill(_statusLabels, _statusHex, s['status']))),
              FieldRow('Description', s['description']),
              const SizedBox(height: 6),
              Text(
                  'Created by ${txt(s['created_by_name'])}${s['created_at'] != null ? ' on ${fmtDate(s['created_at'])}' : ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ],
        ),
      ),
    );
  }
}
