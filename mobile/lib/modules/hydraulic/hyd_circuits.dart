import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_common.dart';
import 'hyd_panels.dart';
import 'hyd_systems.dart';

// Portal: /dashboard/hydraulic/circuits (+ /new, /[id]) and components/hydraulic/CircuitForm.tsx.

const circuitStatusLabels = {'draft': 'Draft', 'under_review': 'Under Review', 'approved': 'Approved', 'superseded': 'Superseded'};
const circuitStatusHex = {'draft': '#78716c', 'under_review': '#2563EB', 'approved': '#16A34A', 'superseded': '#a8a29e'};

class HydCircuitsList extends StatefulWidget {
  const HydCircuitsList({super.key, this.initialStatus = ''});
  final String initialStatus;

  @override
  State<HydCircuitsList> createState() => _HydCircuitsListState();
}

class _HydCircuitsListState extends State<HydCircuitsList> {
  final _list = GlobalKey<ApiListViewState>();
  String _medium = '';
  late String _status = widget.initialStatus;
  bool _superseded = false;
  int? _count;

  void _refilter(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: hydCan('circuits', 'create')
          ? CreateFab(
              label: 'New Circuit',
              onPressed: () async {
                await openCircuitForm(context);
                _list.currentState?.reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search circuit no., title or drawing no…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/circuits', query: {
            'system_type': _medium,
            'status': _status,
            if (_superseded) 'include_superseded': true,
            'search': search,
          });
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Circuits', subtitle: 'Hydraulic & Pneumatic'),
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
                options: circuitStatusLabels,
                onChanged: (v) => _refilter(() => _status = v)),
          ]),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: CheckboxListTile(
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text('Show superseded'),
              subtitle: _status.isNotEmpty
                  ? const Text('A status filter is set, so this has no effect — clear it to use this toggle.')
                  : null,
              value: _superseded,
              onChanged: _status.isNotEmpty ? null : (v) => _refilter(() => _superseded = v ?? false),
            ),
          ),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText: 'No circuits match. Create one, upload its ISO 1219 schematic, and send it for review.',
        itemBuilder: (ctx, c, reload) => Opacity(
          opacity: c['status'] == 'superseded' ? 0.65 : 1,
          child: RecordCard(
            code: '${c['circuit_number']} · Rev ${c['revision']}',
            title: txt(c['title']),
            trailing: Padding(
                padding: const EdgeInsets.only(left: 8), child: pill(circuitStatusLabels, circuitStatusHex, c['status'])),
            meta: [
              ('System', c['system_number'] != null ? '${c['system_number']} — ${c['system_name'] ?? ''}' : '—'),
              ('Type', lbl(systemTypeLabels, c['system_type'])),
              ('Files', (toInt(c['document_count']) ?? 0) > 0 ? '${c['document_count']}' : '—'),
              (
                'Approved',
                c['approved_at'] != null
                    ? '${fmtDate(c['approved_at'])}${c['approved_by_name'] != null ? ' · ${c['approved_by_name']}' : ''}'
                    : '—'
              ),
            ],
            onTap: () async {
              await pushPage(ctx, HydCircuitDetail(id: toInt(c['id'])!));
              reload();
            },
          ),
        ),
      ),
    );
  }
}

/// New / edit circuit revision (portal CircuitForm; draft only). Returns the record.
Future<Json?> openCircuitForm(BuildContext context, {Json? initial, int? defaultSystemId, String? defaultSystemLabel}) async {
  final i = initial ?? const <String, dynamic>{};
  var title = (i['title'] ?? '') as String;
  int? systemId = toInt(i['system_id']) ?? defaultSystemId;
  String? systemLabel = i['system_number'] != null ? '${i['system_number']} — ${i['system_name'] ?? ''}' : defaultSystemLabel;
  var systemType = (i['system_type'] ?? 'hydraulic') as String;
  final systemMedium = <int, String>{};
  var drawingNumber = (i['drawing_number'] ?? '') as String;
  var symbolStandard = initial != null ? (i['symbol_standard'] ?? '') as String : 'ISO 1219-1';
  var description = (i['description'] ?? '') as String;
  var changeNote = (i['change_note'] ?? '') as String;
  Json? saved;

  // The chosen system's medium (lookup `extra`) decides the circuit's medium.
  if (systemId != null) {
    try {
      for (final r in rowsOf(await Api.get('/hydraulic/lookups/systems'))) {
        final id = toInt(r['id']);
        if (id != null && r['extra'] is String) systemMedium[id] = r['extra'] as String;
      }
    } catch (_) {/* medium falls back to the saved one */}
  }
  if (!context.mounted) return null;
  String effective() => (systemId != null ? systemMedium[systemId] : null) ?? systemType;

  final ok = await showFormSheet(
    context,
    title: initial == null ? 'New Circuit' : 'Edit ${i['circuit_number']} Rev ${i['revision']}',
    saveLabel: initial == null ? 'Create Circuit' : 'Save Changes',
    builder: (ctx, setS) => [
      Hint(initial == null
          ? 'Created as Rev A (draft). Upload the schematic on the next page, then submit it for review.'
          : 'Draft revision — saving does not submit it for review.'),
      const FormHeading('Circuit'),
      AppTextField(label: 'Title', required: true, initialValue: title, hint: 'Main press circuit', onChanged: (v) => title = v),
      AppSelect<int>(
        label: 'System',
        value: systemId,
        valueLabel: systemLabel,
        loadOptions: hydLookup('/hydraulic/lookups/systems', onRows: (rows) {
          for (final r in rows) {
            final id = toInt(r['id']);
            if (id != null && r['extra'] is String) systemMedium[id] = r['extra'] as String;
          }
        }),
        onChanged: (o) => setS(() {
          systemId = o?.value;
          systemLabel = o?.label;
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
      Hint(systemId != null
          ? 'The medium follows the linked system.'
          : initial != null
              ? "The medium can't be changed after creation — link a system to take on its medium."
              : "Pick a system to take on its medium, or choose one here — it can't be changed later."),
      const FormHeading('Drawing'),
      TwoUp(
        AppTextField(label: 'Drawing Number', initialValue: drawingNumber, hint: 'PRL-HYD-0012', onChanged: (v) => drawingNumber = v),
        AppTextField(label: 'Symbol Standard', initialValue: symbolStandard, hint: 'ISO 1219-1', onChanged: (v) => symbolStandard = v),
      ),
      AppTextField(
          label: 'Description (optional)',
          maxLines: 3,
          initialValue: description,
          hint: 'What the circuit does — actuators, sequence, pressure settings…',
          onChanged: (v) => description = v),
      AppTextField(
          label: 'Change Note (optional)',
          maxLines: 2,
          initialValue: changeNote,
          hint: initial != null && i['revision'] != 'A' ? 'What changed in this revision' : 'Initial issue',
          onChanged: (v) => changeNote = v),
    ],
    onSave: () async {
      if (title.trim().isEmpty) throw 'Circuit title is required — e.g. "Main press circuit" or "Clamp cylinder circuit".';
      final payload = {
        if (initial == null) 'system_type': effective(),
        'title': title.trim(),
        'system_id': systemId,
        'drawing_number': blankToNull(drawingNumber),
        'symbol_standard': blankToNull(symbolStandard),
        'description': blankToNull(description),
        'change_note': blankToNull(changeNote),
      };
      final r = initial == null
          ? await Api.post('/hydraulic/circuits', data: payload)
          : await Api.patch('/hydraulic/circuits/${i['id']}', data: payload);
      saved = asJson(r);
    },
  );
  if (!ok || saved == null) return null;
  if (initial == null && context.mounted) openScreen(context, HydCircuitDetail(id: toInt(saved!['id'])!));
  return saved;
}

class HydCircuitDetail extends StatefulWidget {
  const HydCircuitDetail({super.key, required this.id});
  final int id;

  @override
  State<HydCircuitDetail> createState() => _HydCircuitDetailState();
}

class _HydCircuitDetailState extends State<HydCircuitDetail> {
  int? _docCount;

  int get id => widget.id;

  Future<void> _prompt(BuildContext ctx, Json c, DetailCtl ctl, String kind) async {
    final rev = c['revision'];
    final v = await promptDialog(
      ctx,
      title: {'approve': 'Approve circuit?', 'return': 'Return for changes?', 'revise': 'Raise a new revision?'}[kind]!,
      message: {
        'approve':
            'Approving makes Rev $rev the revision in force; any earlier approved revision becomes superseded. Remarks are optional.',
        'return':
            'The circuit goes back to draft so the author can fix it. Say what needs changing — the author is notified with your remarks.',
        'revise':
            'A new draft revision is created from Rev $rev, which stays in force until the new one is approved. Describe what will change.',
      }[kind],
      label: {'approve': 'Remarks', 'return': 'What needs fixing', 'revise': 'Change note'}[kind]!,
      required: kind != 'approve',
      confirmLabel: {'approve': 'Approve', 'return': 'Return for Changes', 'revise': 'Raise Revision'}[kind]!,
    );
    if (v == null || !ctx.mounted) return;
    if (kind == 'approve') {
      await ctl.run(ctx, () async {
        ctl.setRecord(asJson(await Api.post('/hydraulic/circuits/$id/approve', data: {'remarks': v.isEmpty ? null : v})));
      }, success: 'Circuit approved — it is now the revision in force.');
    } else if (kind == 'return') {
      await ctl.run(ctx, () async {
        ctl.setRecord(asJson(await Api.post('/hydraulic/circuits/$id/return', data: {'remarks': v})));
      }, success: 'Circuit returned to draft with your remarks.');
    } else {
      Json? next;
      await ctl.run(ctx, () async {
        next = asJson(await Api.post('/hydraulic/circuits/$id/revise', data: {'change_note': v}));
      }, success: 'New revision raised.');
      if (next != null && ctx.mounted) {
        Navigator.of(ctx).pushReplacement(MaterialPageRoute<void>(builder: (_) => HydCircuitDetail(id: toInt(next!['id'])!)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = hydCan('circuits', 'edit');
    final canApprove = hydCan('circuits', 'approve');
    final canSubmit = hydCanFeature('circuits', 'submit_review', 'submit');
    final canRevise = hydCanFeature('circuits', 'revisions', 'create');
    final seeRevisions = hydCanFeature('circuits', 'revisions', 'view');
    final seeDocs = hydCanFeature('circuits', 'documents', 'view');
    return HydDetail(
      fallbackTitle: 'Circuit',
      load: () async {
        final c = asJson(await Api.get('/hydraulic/circuits/$id'));
        _docCount = toInt(c['document_count']);
        return c;
      },
      title: (c) => '${c['circuit_number']} Rev ${c['revision']}',
      actions: (ctx, c, ctl) {
        final isDraft = c['status'] == 'draft';
        final noFiles = seeDocs && (_docCount ?? toInt(c['document_count']) ?? 0) == 0;
        final approvalId = c['approval_request_id'];
        return [
          if (isDraft && canEdit)
            secondaryBtn('Edit', () async {
              final r = await openCircuitForm(ctx, initial: c);
              if (r != null) {
                ctl.setRecord(r);
                if (ctx.mounted) showSnack(ctx, 'Circuit saved.');
              }
            }),
          if (isDraft && canSubmit)
            primaryBtn(
                'Submit for Review',
                noFiles
                    ? null
                    : () => ctl.run(ctx, () async {
                          ctl.setRecord(asJson(await Api.post('/hydraulic/circuits/$id/submit')));
                        }, success: 'Submitted for review — an approver has to check it now.')),
          if (isDraft && hydCanDelete('circuits', c['created_by_id']))
            dangerBtn('Delete', () async {
              final yes = await confirmDialog(ctx,
                  title: 'Delete this draft revision?',
                  message:
                      '${c['circuit_number']} Rev ${c['revision']} and its attached drawings will be removed. Earlier approved revisions are not affected.',
                  confirmLabel: 'Delete',
                  danger: true);
              if (!yes || !ctx.mounted) return;
              if (await ctl.run(ctx, () => Api.delete('/hydraulic/circuits/$id'), success: 'Circuit deleted.') && ctx.mounted) {
                Navigator.pop(ctx);
              }
            }),
          if (c['status'] == 'under_review' && approvalId == null && canApprove) ...[
            primaryBtn('Approve', () => _prompt(ctx, c, ctl, 'approve')),
            dangerBtn('Return for Changes', () => _prompt(ctx, c, ctl, 'return')),
          ],
          if (c['status'] == 'approved' && canRevise) primaryBtn('Raise New Revision', () => _prompt(ctx, c, ctl, 'revise')),
        ];
      },
      sections: (ctx, c, ctl) {
        final isDraft = c['status'] == 'draft';
        final revisions = (c['revisions'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        final noFiles = seeDocs && (_docCount ?? toInt(c['document_count']) ?? 0) == 0;
        return [
          if (isDraft && canSubmit && noFiles)
            const NoteBox('Upload the circuit diagram below before submitting — reviewers need a drawing to check.', hex: '#78716c'),
          if (c['status'] == 'superseded')
            const NoteBox('This revision has been superseded by a later approved revision — see the revision history below.',
                hex: '#78716c'),
          if (isDraft && (c['review_remarks'] as String?)?.isNotEmpty == true)
            NoteBox(c['review_remarks'] as String, title: 'Returned for changes'),
          HydApprovalPanel(
            key: ValueKey('apr-${c['id']}-${c['status']}-${c['approval_request_id']}'),
            entityType: 'hyd_circuit',
            entityId: id,
            title: 'Review',
            onChanged: ctl.reload,
          ),
          SummaryCard(
            eyebrow: 'Hydraulic & Pneumatic · Circuit',
            title: txt(c['title']),
            text: c['description'] as String?,
            badges: [
              pill(circuitStatusLabels, circuitStatusHex, c['status']),
              pill(systemTypeLabels, systemTypeHex, c['system_type']),
            ],
            meta: c['drawing_number'] != null ? '· Dwg ${c['drawing_number']}' : null,
          ),
          DetailSection('Circuit', children: [
            FieldRow(
              'System',
              c['system_number'] != null
                  ? InkWell(
                      onTap: () => openScreen(ctx, HydSystemDetail(id: toInt(c['system_id'])!)),
                      child: Text('${c['system_number']}${c['system_name'] != null ? ' — ${c['system_name']}' : ''} →',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                    )
                  : 'Not linked to a system',
            ),
            FieldRow('Symbol standard', c['symbol_standard']),
            FieldRow('Change note', c['change_note']),
          ]),
          DetailSection('Review trail', children: [
            FieldRow('Created by',
                '${c['created_by_name'] ?? '—'}${c['created_at'] != null ? ' · ${fmtDateTime(c['created_at'])}' : ''}'),
            FieldRow('Submitted',
                c['submitted_at'] != null ? '${c['submitted_by_name'] ?? '—'} · ${fmtDateTime(c['submitted_at'])}' : null),
            FieldRow('Approved',
                c['approved_at'] != null ? '${c['approved_by_name'] ?? '—'} · ${fmtDateTime(c['approved_at'])}' : null),
            if (!isDraft && (c['review_remarks'] as String?)?.isNotEmpty == true)
              FieldRow('Approval remarks', c['review_remarks']),
          ]),
          if (seeRevisions)
            DetailSection('Revision History (${revisions.length})', children: [
              if (revisions.isEmpty) const Hint('No revisions recorded.'),
              for (final r in revisions.reversed)
                MiniRow(
                  code: 'Rev ${r['revision']}${toInt(r['id']) == id ? '  ·  Viewing' : ''}',
                  title: txt(r['change_note']),
                  meta: r['approved_at'] != null ? 'Approved ${fmtDate(r['approved_at'])}' : 'Not approved',
                  badge: pill(circuitStatusLabels, circuitStatusHex, r['status']),
                  highlight: toInt(r['id']) == id,
                  onTap: toInt(r['id']) == id ? null : () => openScreen(ctx, HydCircuitDetail(id: toInt(r['id'])!)),
                ),
            ]),
          HydDocumentsPanel(
            key: ValueKey('docs-${c['id']}-${c['status']}'),
            entityType: 'circuit',
            entityId: id,
            title: 'Circuit Drawings',
            defaultDocType: 'circuit_diagram',
            readOnly: c['status'] != 'draft',
            readOnlyNote: 'Drawings on a submitted/approved revision are controlled — raise a new revision to change them.',
            onCount: (n) {
              if (n != _docCount && mounted) setState(() => _docCount = n);
            },
          ),
        ];
      },
    );
  }
}
