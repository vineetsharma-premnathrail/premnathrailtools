import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_circuits.dart';
import 'hyd_common.dart';
import 'hyd_components.dart';
import 'hyd_panels.dart';
import 'hyd_systems.dart';

// Portal: /dashboard/hydraulic/bom (+ /new, /[id]) and components/hydraulic/HydBomForm.tsx.

const bomStatusLabels = {'draft': 'Draft', 'under_review': 'Awaiting Release Approval', 'released': 'Released', 'obsolete': 'Obsolete'};
const bomStatusHex = {'draft': '#78716c', 'under_review': '#2563EB', 'released': '#16A34A', 'obsolete': '#a8a29e'};

class HydBomList extends StatefulWidget {
  const HydBomList({super.key, this.initialStatus = ''});
  final String initialStatus;

  @override
  State<HydBomList> createState() => _HydBomListState();
}

class _HydBomListState extends State<HydBomList> {
  final _list = GlobalKey<ApiListViewState>();
  String _medium = '';
  late String _status = widget.initialStatus;
  int? _count;

  void _refilter(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final seeCosts = hydSeeCosts();
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: hydCan('bom', 'create')
          ? CreateFab(
              label: 'New BOM',
              onPressed: () async {
                await openBomForm(context);
                _list.currentState?.reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search BOM no. or title…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/boms', query: {'system_type': _medium, 'status': _status, 'search': search});
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Bills of Material', subtitle: 'Hydraulic & Pneumatic'),
          FilterBar(children: [
            FilterPill(
                label: 'Medium',
                value: _medium,
                allLabel: 'Hydraulic + Pneumatic',
                options: systemTypeLabels,
                onChanged: (v) => _refilter(() => _medium = v)),
            FilterPill(
                label: 'Status',
                value: _status,
                allLabel: 'All statuses',
                options: bomStatusLabels,
                onChanged: (v) => _refilter(() => _status = v)),
          ]),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText: 'No BOMs match. Create one to list the components a system or circuit is built from.',
        itemBuilder: (ctx, b, reload) => Opacity(
          opacity: b['status'] == 'obsolete' ? 0.65 : 1,
          child: RecordCard(
            code: '${b['bom_number']} · Rev ${b['revision']}',
            title: txt(b['title']),
            trailing:
                Padding(padding: const EdgeInsets.only(left: 8), child: pill(bomStatusLabels, bomStatusHex, b['status'])),
            meta: [
              ('System', b['system_number'] != null ? '${b['system_number']} — ${b['system_name'] ?? ''}' : '—'),
              ('Circuit', b['circuit_number'] != null ? '${b['circuit_number']} Rev ${b['circuit_revision'] ?? '?'}' : '—'),
              ('Lines', txt(b['line_count'])),
              if (seeCosts) ('Total Cost', inr(b['total_cost'])),
            ],
            onTap: () async {
              await pushPage(ctx, HydBomDetail(id: toInt(b['id'])!));
              reload();
            },
          ),
        ),
      ),
    );
  }
}

class _Line {
  _Line({this.tag = '', this.componentId, this.componentLabel, this.qty = '1', this.uom = 'NOS', this.remarks = ''})
      : key = ++_seq;
  static int _seq = 0;
  final int key;
  String tag;
  int? componentId;
  String? componentLabel;
  String qty;
  String uom;
  String remarks;

  bool get blank => componentId == null && tag.trim().isEmpty && remarks.trim().isEmpty;
}

/// New / edit draft BOM (portal HydBomForm). Saving replaces the line list.
Future<Json?> openBomForm(BuildContext context,
    {Json? initial, int? defaultSystemId, String? defaultSystemLabel, String? defaultSystemType}) async {
  final i = initial ?? const <String, dynamic>{};
  final seeCosts = hydSeeCosts();
  var title = (i['title'] ?? '') as String;
  int? systemId = toInt(i['system_id']) ?? defaultSystemId;
  String? systemLabel = i['system_number'] != null ? '${i['system_number']} — ${i['system_name'] ?? ''}' : defaultSystemLabel;
  var systemType = (i['system_type'] ?? defaultSystemType ?? 'hydraulic') as String;
  int? circuitId = toInt(i['circuit_id']);
  String? circuitLabel = i['circuit_number'] != null ? '${i['circuit_number']} Rev ${i['circuit_revision'] ?? '?'}' : null;
  var remarks = (i['remarks'] ?? '') as String;
  final items = (i['items'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  final lines = items.isEmpty
      ? [_Line()]
      : [
          for (final it in items)
            _Line(
              tag: (it['tag_number'] ?? '') as String,
              componentId: toInt(it['component_id']),
              componentLabel: '${it['component_code'] ?? '#${it['component_id']}'} — ${it['component_name'] ?? 'Component'}',
              qty: numStr(it['quantity']),
              uom: (it['uom'] ?? 'NOS') as String,
              remarks: (it['remarks'] ?? '') as String,
            ),
        ];
  final systemMedium = <int, String>{};
  final unitCosts = <int, num>{
    for (final it in items)
      if (toInt(it['component_id']) != null && toNum(it['unit_cost']) != null) toInt(it['component_id'])!: toNum(it['unit_cost'])!,
  };
  Json? saved;

  void takeSystems(List<Json> rows) {
    for (final r in rows) {
      final id = toInt(r['id']);
      if (id != null && r['extra'] is String) systemMedium[id] = r['extra'] as String;
    }
  }

  try {
    takeSystems(rowsOf(await Api.get('/hydraulic/lookups/systems')));
  } catch (_) {/* medium falls back to the saved one */}
  if (!context.mounted) return null;
  String effective() => (systemId != null ? systemMedium[systemId] : null) ?? systemType;
  num lineCost(_Line l) {
    final q = num.tryParse(l.qty.trim()) ?? 0;
    if (l.componentId == null || q <= 0) return 0;
    return (unitCosts[l.componentId] ?? 0) * q;
  }

  final ok = await showFormSheet(
    context,
    title: initial == null ? 'New BOM' : 'Edit Draft — ${i['bom_number']} Rev ${i['revision']}',
    saveLabel: initial == null ? 'Create BOM' : 'Save Changes',
    builder: (ctx, setS) {
      final filled = lines.where((l) => l.componentId != null).length;
      final total = lines.fold<num>(0, (s, l) => s + lineCost(l));
      return [
        Hint(initial == null
            ? 'Bill of material for a system or circuit — tag each line with the circuit symbol (P1, V3…).'
            : "Saving replaces the draft's line list; it does not submit it for release."),
        const FormHeading('BOM'),
        AppTextField(label: 'Title', required: true, initialValue: title, hint: 'Power pack BOM', onChanged: (v) => title = v),
        AppSelect<int>(
          label: 'System',
          value: systemId,
          valueLabel: systemLabel,
          loadOptions: hydLookup('/hydraulic/lookups/systems', onRows: takeSystems),
          onChanged: (o) => setS(() {
            systemId = o?.value;
            systemLabel = o?.label;
            circuitId = null;
            circuitLabel = null;
          }),
        ),
        if (initial == null && systemId == null)
          AppSelect<String>(
              label: 'Medium',
              required: true,
              value: systemType,
              options: optionsOf(systemTypeLabels),
              onChanged: (o) => setS(() => systemType = o?.value ?? systemType))
        else
          ReadOnlyField(label: 'Medium', value: lbl(systemTypeLabels, effective())),
        AppSelect<int>(
          key: ValueKey('circuit-$systemId'),
          label: 'Circuit',
          value: circuitId,
          valueLabel: circuitLabel,
          loadOptions: hydLookup('/hydraulic/lookups/circuits', query: {'system_id': systemId}),
          onChanged: (o) => setS(() {
            circuitId = o?.value;
            circuitLabel = o?.label;
          }),
        ),
        Hint(systemId != null
            ? 'Circuits and components are limited to the chosen system and its medium.'
            : 'Pick a system to narrow the circuit list; the component list follows the medium.'),
        if (seeCosts) ...[
          const FormHeading('Estimated Cost'),
          Text(inr(total), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
          Hint(
              "$filled line${filled == 1 ? '' : 's'} · estimated from component master unit costs. The saved BOM's roll-up is computed by the server."),
        ],
        AppTextField(label: 'Remarks (optional)', maxLines: 2, initialValue: remarks, onChanged: (v) => remarks = v),
        FormHeading('Lines ($filled)',
            trailing: TextButton.icon(
              onPressed: () => setS(() => lines.add(_Line())),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Add Line'),
            )),
        if (lines.isEmpty) const Hint('No lines yet — a BOM needs at least one component line before it can be released.'),
        for (final (n, l) in lines.indexed)
          Container(
            key: ValueKey('line-${l.key}'),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: Brand.background, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
            child: Column(children: [
              Row(children: [
                Text('Line ${n + 1}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                const Spacer(),
                if (seeCosts && l.componentId != null)
                  Text(inr(lineCost(l)), style: const TextStyle(fontSize: 13, color: Brand.muted)),
                IconButton(
                  tooltip: 'Remove line',
                  icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFB91C1C)),
                  onPressed: () => setS(() => lines.remove(l)),
                ),
              ]),
              AppSelect<int>(
                label: 'Component',
                required: true,
                value: l.componentId,
                valueLabel: l.componentLabel,
                loadOptions: hydLookup('/hydraulic/lookups/components', query: {'system_type': effective()}, onRows: (rows) {
                  for (final r in rows) {
                    final id = toInt(r['id']);
                    final cost = toNum(r['unit_cost']);
                    if (id != null && cost != null) unitCosts[id] = cost;
                  }
                }),
                onChanged: (o) => setS(() {
                  l.componentId = o?.value;
                  l.componentLabel = o?.label;
                }),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: AppTextField(label: 'Tag', initialValue: l.tag, hint: 'P1', onChanged: (v) => l.tag = v)),
                const SizedBox(width: 8),
                Expanded(
                    child: AppTextField(
                        label: 'Qty *',
                        initialValue: l.qty,
                        keyboardType: AppTextField.number,
                        onChanged: (v) => setS(() => l.qty = v))),
                const SizedBox(width: 8),
                Expanded(child: AppTextField(label: 'UOM *', initialValue: l.uom, onChanged: (v) => l.uom = v)),
              ]),
              const SizedBox(height: 10),
              AppTextField(label: 'Remarks', initialValue: l.remarks, onChanged: (v) => l.remarks = v),
            ]),
          ),
      ];
    },
    onSave: () async {
      if (title.trim().isEmpty) throw 'BOM title is required — e.g. "Power pack BOM" or "Clamp circuit BOM".';
      final filled = lines.where((l) => !l.blank).toList();
      for (final l in filled) {
        final tag = l.tag.trim().toUpperCase();
        final where = 'Line ${lines.indexOf(l) + 1}${tag.isNotEmpty ? ' (tag $tag)' : ''}';
        if (l.componentId == null) throw '$where has no component — pick one from the component master or remove the line.';
        if (!((num.tryParse(l.qty.trim()) ?? 0) > 0)) throw '$where: quantity must be more than zero.';
        if (l.uom.trim().isEmpty) throw '$where: unit of measure is required (e.g. NOS, M, SET).';
        if (tag.length > 30) throw '$where: tag number can be at most 30 characters.';
      }
      final tags = filled.map((l) => l.tag.trim().toUpperCase()).where((t) => t.isNotEmpty).toList();
      final dupes = {for (final (n, t) in tags.indexed) if (tags.indexOf(t) != n) t};
      if (dupes.isNotEmpty) {
        throw 'Tag ${dupes.join(', ')} is used on more than one line — each circuit tag should appear once. Combine the lines or correct the tag.';
      }
      final payload = {
        if (initial == null) 'system_type': effective(),
        'title': title.trim(),
        'system_id': systemId,
        'circuit_id': circuitId,
        'remarks': blankToNull(remarks),
        'items': [
          for (final l in filled)
            {
              'component_id': l.componentId,
              'tag_number': blankToNull(l.tag.toUpperCase()),
              'quantity': num.parse(l.qty.trim()),
              'uom': l.uom.trim().toUpperCase(),
              'remarks': blankToNull(l.remarks),
            },
        ],
      };
      final r = initial == null
          ? await Api.post('/hydraulic/boms', data: payload)
          : await Api.patch('/hydraulic/boms/${i['id']}', data: payload);
      saved = asJson(r);
    },
  );
  if (!ok || saved == null) return null;
  if (initial == null && context.mounted) openScreen(context, HydBomDetail(id: toInt(saved!['id'])!));
  return saved;
}

class HydBomDetail extends StatelessWidget {
  const HydBomDetail({super.key, required this.id});
  final int id;

  Future<void> _confirm(BuildContext ctx, Json b, DetailCtl ctl, String kind) async {
    final yes = await confirmDialog(
      ctx,
      title: {'release': 'Release BOM?', 'submit': 'Send for release approval?', 'revise': 'Raise a new revision?', 'delete': 'Delete draft BOM?'}[kind]!,
      message: {
        'release':
            'Released BOMs are locked; changes need a new revision. Save any edits first — the last saved lines are what gets released. Any earlier released revision becomes obsolete.',
        'submit':
            'The BOM is locked while it waits; an approver (Organization › Approval Workflows) releases it or returns it to draft. Save any edits first — the last saved lines are what gets submitted.',
        'revise': 'A new draft revision is created as a copy of Rev ${b['revision']}, which stays released until the new one is released.',
        'delete': '${b['bom_number']} Rev ${b['revision']} and its lines will be removed. Released revisions are not affected.',
      }[kind]!,
      confirmLabel: {'release': 'Release', 'submit': 'Submit', 'revise': 'Raise Revision', 'delete': 'Delete'}[kind]!,
      danger: kind == 'delete',
    );
    if (!yes || !ctx.mounted) return;
    switch (kind) {
      case 'release':
        Json? u;
        await ctl.run(ctx, () async => u = asJson(await Api.post('/hydraulic/boms/$id/release')));
        if (u != null) {
          ctl.setRecord(u!);
          if (ctx.mounted) {
            showSnack(
                ctx,
                u!['status'] == 'released'
                    ? '${u!['bom_number']} Rev ${u!['revision']} released — it is now locked.'
                    : '${u!['bom_number']} Rev ${u!['revision']} is waiting for release approval — see the approval below.');
          }
        }
      case 'submit':
        Json? u;
        await ctl.run(ctx, () async => u = asJson(await Api.post('/hydraulic/boms/$id/submit')));
        if (u != null) {
          ctl.setRecord(u!);
          if (ctx.mounted) {
            showSnack(
                ctx,
                u!['status'] == 'released'
                    ? '${u!['bom_number']} Rev ${u!['revision']} released — no approval was needed.'
                    : '${u!['bom_number']} Rev ${u!['revision']} sent for release approval — the approvers have been notified.');
          }
        }
      case 'revise':
        Json? next;
        await ctl.run(ctx, () async => next = asJson(await Api.post('/hydraulic/boms/$id/revise')), success: 'New revision raised.');
        if (next != null && ctx.mounted) {
          Navigator.of(ctx).pushReplacement(MaterialPageRoute<void>(builder: (_) => HydBomDetail(id: toInt(next!['id'])!)));
        }
      case 'delete':
        if (await ctl.run(ctx, () => Api.delete('/hydraulic/boms/$id'), success: 'BOM deleted.') && ctx.mounted) {
          Navigator.pop(ctx);
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final seeCosts = hydSeeCosts();
    return HydDetail(
      fallbackTitle: 'BOM',
      load: () async => asJson(await Api.get('/hydraulic/boms/$id')),
      title: (b) => '${b['bom_number']} Rev ${b['revision']}',
      actions: (ctx, b, ctl) {
        final isDraft = b['status'] == 'draft';
        final canRelease = hydCan('bom', 'approve');
        return [
          if (isDraft && hydCan('bom', 'edit'))
            secondaryBtn('Edit', () async {
              final r = await openBomForm(ctx, initial: b);
              if (r != null) {
                ctl.setRecord(r);
                if (ctx.mounted) showSnack(ctx, 'BOM saved.');
              }
            }),
          if (isDraft && hydCan('bom', 'submit'))
            (canRelease ? secondaryBtn : primaryBtn)('Submit for Release Approval', () => _confirm(ctx, b, ctl, 'submit')),
          if (canRelease && (isDraft || (b['status'] == 'under_review' && b['approval_request_id'] == null)))
            primaryBtn('Release', () => _confirm(ctx, b, ctl, 'release')),
          if (b['status'] == 'released' && hydCanFeature('bom', 'revise', 'create'))
            primaryBtn('Raise New Revision', () => _confirm(ctx, b, ctl, 'revise')),
          if (hydCan('bom', 'export'))
            secondaryBtn(
                'Export CSV',
                () => ctl.run(ctx,
                    () => Files.downloadAndOpen('/hydraulic/boms/$id/export', '${b['bom_number']}-Rev${b['revision']}.csv'))),
          if (isDraft && hydCanDelete('bom', b['created_by_id'])) dangerBtn('Delete', () => _confirm(ctx, b, ctl, 'delete')),
        ];
      },
      sections: (ctx, b, ctl) {
        final items = (b['items'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        final lc = toInt(b['line_count']) ?? items.length;
        return [
          if (b['status'] == 'obsolete')
            const NoteBox('This revision is obsolete — a later revision has been released.', hex: '#78716c'),
          HydApprovalPanel(
            key: ValueKey('apr-${b['id']}-${b['status']}-${b['approval_request_id']}'),
            entityType: 'hyd_bom',
            entityId: id,
            title: 'Release approval',
            onChanged: ctl.reload,
          ),
          SummaryCard(
            eyebrow: 'Hydraulic & Pneumatic · BOM',
            title: txt(b['title']),
            badges: [
              pill(bomStatusLabels, bomStatusHex, b['status']),
              pill(systemTypeLabels, systemTypeHex, b['system_type']),
            ],
            meta: '· $lc line${lc == 1 ? '' : 's'}${seeCosts && b['total_cost'] != null ? ' · Total ${inr(b['total_cost'])}' : ''}',
          ),
          DetailSection('Linked to', children: [
            FieldRow(
              'System',
              b['system_number'] != null
                  ? InkWell(
                      onTap: () => openScreen(ctx, HydSystemDetail(id: toInt(b['system_id'])!)),
                      child: Text('${b['system_number']}${b['system_name'] != null ? ' — ${b['system_name']}' : ''} →',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                    )
                  : 'Not linked to a system',
            ),
            FieldRow(
              'Circuit',
              b['circuit_number'] != null
                  ? InkWell(
                      onTap: () => openScreen(ctx, HydCircuitDetail(id: toInt(b['circuit_id'])!)),
                      child: Text('${b['circuit_number']} Rev ${b['circuit_revision'] ?? '?'} →',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                    )
                  : null,
            ),
            if ((b['remarks'] as String?)?.isNotEmpty == true) FieldRow('Remarks', b['remarks']),
          ]),
          DetailSection('Release trail', children: [
            FieldRow('Created by',
                '${b['created_by_name'] ?? '—'}${b['created_at'] != null ? ' · ${fmtDateTime(b['created_at'])}' : ''}'),
            FieldRow('Released',
                b['released_at'] != null ? '${b['released_by_name'] ?? '—'} · ${fmtDateTime(b['released_at'])}' : null),
          ]),
          DetailSection('Lines (${items.length})', children: [
            if (items.isEmpty) const Hint('No lines on this BOM.'),
            for (final it in items)
              InkWell(
                onTap: toInt(it['component_id']) == null
                    ? null
                    : () => openScreen(ctx, HydComponentDetail(id: toInt(it['component_id'])!)),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      if ((it['tag_number'] as String?)?.isNotEmpty == true) ...[
                        Text(it['tag_number'] as String,
                            style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                        const SizedBox(width: 8),
                      ],
                      Text(txt(it['component_code'] ?? '#${it['component_id']}'),
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                      const Spacer(),
                      Text('${fmtNumber(it['quantity'])} ${txt(it['uom'])}',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                    ]),
                    Text(txt(it['component_name']), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                    Text(
                        [
                          if (it['component_category'] != null) lbl(componentCategoryLabels, it['component_category']),
                          [it['manufacturer'], it['model_number']].whereType<String>().where((s) => s.isNotEmpty).join(' '),
                        ].where((s) => s.isNotEmpty).join(' · '),
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if ((it['remarks'] as String?)?.isNotEmpty == true)
                      Text(it['remarks'] as String, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if (seeCosts)
                      Text('Unit ${inr(it['unit_cost'])} · Line ${inr(it['line_cost'])}',
                          style: const TextStyle(fontSize: 12, color: Brand.body)),
                  ]),
                ),
              ),
            if (seeCosts && items.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(children: [
                  const Expanded(child: Text('Total', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
                  Text(inr(b['total_cost']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                ]),
              ),
          ]),
        ];
      },
    );
  }
}
