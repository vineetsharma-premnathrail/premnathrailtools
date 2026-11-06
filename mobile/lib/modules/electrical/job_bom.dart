// BOM tab - phone copy of frontend/src/components/electrical/BomTab.tsx: the
// electrical BOM (Component Selection, Specification, Purchase Requirement),
// submit a line's selection for approval, Link / Unlink PR, Raise PR.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'approval_panel.dart';
import 'common.dart';

class BomTab extends StatefulWidget {
  const BomTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged, this.focusId});
  final Json job;
  final ElecMeta meta;
  final bool canEdit;
  final VoidCallback onChanged;

  /// BOM line whose approval opens on load (approval link).
  final int? focusId;

  @override
  State<BomTab> createState() => _BomTabState();
}

class _BomTabState extends State<BomTab> {
  List<Json> _items = [];
  List<Json> _panels = [];
  bool _loaded = false;
  String? _error;
  bool _busy = false;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  bool get _isOpen => workingStatuses.contains(str(job['status']));
  bool get _seeCosts => Elec.sees('costs');
  bool get _seePanels => Elec.sees('panels');

  @override
  void initState() {
    super.initState();
    _load(first: true);
  }

  Future<void> _load({bool first = false}) async {
    try {
      final res = await Future.wait([
        Api.get('/electrical/jobs/$jobId/bom'),
        if (_seePanels) Api.get('/electrical/jobs/$jobId/panels'),
      ]);
      if (!mounted) return;
      setState(() {
        _items = rowsOf(res[0]);
        _panels = res.length > 1 ? rowsOf(res[1]) : [];
        _error = null;
        _loaded = true;
      });
      if (first && widget.focusId != null) {
        final hit = _items.where((i) => asInt(i['id']) == widget.focusId).toList();
        if (hit.isNotEmpty) _review(hit.first);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '${first ? 'Could not load' : 'Could not reload'} the electrical BOM for $jobNo. ${ApiClient.describe(e)}';
          _loaded = true;
        });
      }
    }
  }

  Future<bool> _mutate(Future<dynamic> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
      widget.onChanged();
      if (mounted && success != null) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review(Json i) async {
    await openApprovalScreen(
      context,
      entityType: 'electrical_bom_item',
      entityId: asInt(i['id'])!,
      title: 'Component selection — Line ${i['line_no']}',
      subtitle: '${i['description']} · ${str(i['make']).isEmpty ? '—' : i['make']} ${str(i['part_number'])} · '
          '${fmtNumber(i['quantity'])} ${str(i['uom'])}',
    );
    await _load();
    widget.onChanged();
  }

  // ── Add / edit ──

  Future<void> _openForm([Json? editing]) async {
    final cats = widget.meta.componentCategories;
    final defaultCat = cats.containsKey('other') ? 'other' : (cats.keys.isEmpty ? 'other' : cats.keys.first);
    var category = editing == null ? defaultCat : str(editing['category']);
    int? storeItemId = asInt(editing?['store_item_id']);
    String? storeLabel = editing == null ? null : str(editing['store_item_code']);
    final desc = TextEditingController(text: str(editing?['description']));
    final make = TextEditingController(text: str(editing?['make']));
    final part = TextEditingController(text: str(editing?['part_number']));
    final rating = TextEditingController(text: str(editing?['rating']));
    final spec = TextEditingController(text: str(editing?['specification']));
    final qty = TextEditingController(text: editing == null ? '1' : str(editing['quantity']));
    final uom = TextEditingController(text: editing == null ? 'NOS' : (str(editing['uom']).isEmpty ? 'NOS' : str(editing['uom'])));
    final cost = TextEditingController(text: str(editing?['estimated_unit_cost']));
    final remarks = TextEditingController(text: str(editing?['remarks']));
    int? panelId = asInt(editing?['panel_id']);
    var selection = editing == null ? 'proposed' : str(editing['selection_status']);
    var procurement = editing == null ? 'required' : str(editing['procurement_status']);
    final storeRows = <int, Json>{};
    final canApprove = Elec.jf('bom', 'approve');
    final linkedPr = asInt(editing?['p2p_request_id']) != null
        ? (str(editing?['p2p_number']).isEmpty ? 'PR #${editing?['p2p_request_id']}' : str(editing?['p2p_number']))
        : null;
    final procKeys = linkedPr != null
        ? ['pr_raised', 'ordered', 'received', 'issued']
        : ['required', 'in_stock', 'received', 'issued'];
    if (procurement.isNotEmpty && !procKeys.contains(procurement)) procKeys.add(procurement);

    final ok = await showFormSheet(
      context,
      title: editing == null ? 'Add Component' : 'Edit BOM Line ${editing['line_no']}',
      saveLabel: editing == null ? 'Add Component' : 'Save Changes',
      builder: (ctx, setS) => [
        Muted(editing == null ? "New line on $jobNo's electrical BOM." : '${editing['description']} — $jobNo'),
        const FormHeading('Component'),
        AppSelect<String>(
          label: 'Category',
          value: category,
          clearable: false,
          options: optionsOf(cats),
          onChanged: (o) => setS(() => category = o?.value ?? category),
        ),
        AppSelect<int>(
          label: 'Store Item (optional)',
          value: storeItemId,
          valueLabel: storeLabel,
          loadOptions: (q) async {
            final rows = rowsOf(await Api.get('/electrical/lookups/items', query: {'search': q.trim(), 'limit': 500}));
            return [
              for (final r in rows)
                if (asInt(r['id']) != null)
                  () {
                    storeRows[asInt(r['id'])!] = r;
                    return Option(asInt(r['id'])!, str(r['label']));
                  }(),
            ];
          },
          onChanged: (o) => setS(() {
            storeItemId = o?.value;
            storeLabel = o?.label;
            final row = o == null ? null : storeRows[o.value];
            if (row == null) return;
            if (desc.text.trim().isEmpty) {
              final parts = str(row['label']).split(' — ');
              desc.text = parts.length > 1 ? parts.sublist(1).join(' — ') : str(row['label']);
            }
            final extra = str(row['extra']);
            if (extra.isNotEmpty && (uom.text.trim().isEmpty || uom.text.trim().toUpperCase() == 'NOS')) uom.text = extra;
          }),
        ),
        AppTextField(label: 'Description', controller: desc, required: true, hint: 'e.g. MCB 2-pole 16A, Type C'),
        const FormHeading('Selection & Specification'),
        AppTextField(label: 'Make', controller: make, hint: 'e.g. Schneider'),
        AppTextField(label: 'Part Number', controller: part),
        AppTextField(label: 'Rating', controller: rating, hint: 'e.g. 24V DC, 16A'),
        AppTextField(
            label: 'Specification',
            controller: spec,
            maxLines: 3,
            hint: 'Technical specification — standards, IP rating, mounting, etc.'),
        const Muted('Mark a line Selected only after entering its make and part number.', size: 12),
        const FormHeading('Quantity & Cost'),
        AppTextField(label: 'Quantity', controller: qty, required: true, keyboardType: AppTextField.number),
        AppTextField(label: 'UOM', controller: uom),
        if (_seeCosts)
          AppTextField(label: 'Est. Unit Cost (₹)', controller: cost, keyboardType: AppTextField.number),
        const FormHeading('Panel & Status'),
        AppSelect<int>(
          label: 'Panel',
          value: panelId,
          valueLabel: str(editing?['panel_tag']).isEmpty ? null : str(editing?['panel_tag']),
          options: [for (final p in _panels) Option(asInt(p['id'])!, '${p['panel_tag']} — ${p['name']}')],
          onChanged: (o) => setS(() => panelId = o?.value),
        ),
        if (_panels.isEmpty)
          const Muted('No panels on this job yet — add them on the Panels tab to mount components in a panel.', size: 12),
        AppSelect<String>(
          label: 'Selection',
          value: selection,
          clearable: false,
          options: [
            for (final e in selectionLabels.entries)
              if (e.key != 'approved' || canApprove || selection == 'approved' || str(editing?['selection_status']) == 'approved')
                Option(e.key, e.value),
          ],
          onChanged: (o) => setS(() => selection = o?.value ?? selection),
        ),
        AppSelect<String>(
          label: 'Procurement',
          value: procurement,
          clearable: false,
          options: [for (final k in procKeys) if (procurementLabels[k] != null) Option(k, procurementLabels[k]!)],
          onChanged: (o) => setS(() => procurement = o?.value ?? procurement),
        ),
        Muted(linkedPr != null ? 'Linked to $linkedPr' : 'Use Link PR / Raise PR for PR Raised or Ordered', size: 12),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
      ],
      onSave: () async {
        final q = num.tryParse(qty.text.trim());
        final problems = <String>[];
        if (desc.text.trim().isEmpty) problems.add('Enter a description for the component.');
        if (q == null || q <= 0) problems.add('Quantity must be a number greater than 0.');
        final c = numOrNull(cost.text);
        if (cost.text.trim().isNotEmpty && (c == null || c < 0)) {
          problems.add('Estimated unit cost must be 0 or more (leave it blank if not known yet).');
        }
        if ((selection == 'selected' || selection == 'approved') &&
            (make.text.trim().isEmpty || part.text.trim().isEmpty)) {
          problems.add('Enter both the make and the part number before marking the component as '
              '${selectionLabels[selection]!.toLowerCase()}.');
        }
        if (problems.isNotEmpty) throw problems.join(' ');
        final payload = {
          'category': category,
          'description': desc.text.trim(),
          'store_item_id': storeItemId,
          'make': strOrNull(make.text),
          'part_number': strOrNull(part.text),
          'rating': strOrNull(rating.text),
          'specification': strOrNull(spec.text),
          'quantity': q,
          'uom': uom.text.trim().isEmpty ? 'NOS' : uom.text.trim(),
          'estimated_unit_cost': c,
          'panel_id': panelId,
          'selection_status': selection,
          'procurement_status': procurement,
          'remarks': strOrNull(remarks.text),
        };
        if (editing == null) {
          await Api.post('/electrical/jobs/$jobId/bom', data: payload);
        } else {
          await Api.patch('/electrical/jobs/$jobId/bom/${editing['id']}', data: payload);
        }
      },
    );
    final added = desc.text.trim();
    for (final ctrl in [desc, make, part, rating, spec, qty, uom, cost, remarks]) {
      ctrl.dispose();
    }
    if (ok) {
      await _load();
      widget.onChanged();
      if (mounted) {
        showSnack(context, editing == null ? 'Added "$added" to the BOM.' : 'BOM line ${editing['line_no']} updated.');
      }
    }
  }

  // ── PR link ──

  Future<void> _link(Json i) async {
    String? pr;
    final ok = await showFormSheet(
      context,
      title: 'Link PR — Line ${i['line_no']}',
      saveLabel: 'Link PR',
      builder: (ctx, setS) => [
        Muted('${i['description']} · ${fmtNumber(i['quantity'])} ${str(i['uom'])}'),
        const FormHeading('Purchase Requisition'),
        AppSelect<String>(
          label: 'Requisition',
          required: true,
          value: pr,
          valueLabel: pr,
          loadOptions: (q) async {
            final rows = rowsOf(await Api.get('/electrical/lookups/purchase-requisitions', query: {'search': q.trim()}));
            return [
              for (final r in rows)
                if (str(r['code']).isNotEmpty)
                  Option(str(r['code']),
                      str(r['extra']).isNotEmpty ? '${r['label']} · ${str(r['extra']).replaceAll('_', ' ')}' : str(r['label'])),
            ];
          },
          onChanged: (o) => setS(() => pr = o?.value),
        ),
        const Muted('Only live requisitions are listed (Electrical ones first) — search to reach older ones. Linking moves a '
            'To Buy / In Stock line to PR Raised.', size: 12),
      ],
      onSave: () async {
        if (pr == null) throw 'Pick the purchase requisition this line is being bought on.';
        await Api.post('/electrical/jobs/$jobId/bom/${i['id']}/link-pr', data: {'p2p_number': pr});
      },
    );
    if (ok) {
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, 'Linked $pr to BOM line ${i['line_no']}.');
    }
  }

  Future<void> _unlink(Json i) async {
    final ok = await confirmDialog(context,
        title: 'Unlink purchase requisition?',
        message: 'Detach ${str(i['p2p_number']).isEmpty ? 'the PR' : i['p2p_number']} from line ${i['line_no']} '
            '(${i['description']})? The requisition itself stays in Procurement; a PR Raised or Ordered line goes back to To Buy.',
        confirmLabel: 'Unlink',
        danger: true);
    if (ok) {
      await _mutate(() => Api.post('/electrical/jobs/$jobId/bom/${i['id']}/unlink-pr'),
          success: 'PR unlinked from BOM line ${i['line_no']}.');
    }
  }

  void _raisePr(Json i) {
    if (asInt(i['store_item_id']) == null) {
      showSnack(
          context,
          "BOM line ${i['line_no']} isn't linked to an Item Master item, so a requisition can't be raised for it. Edit the "
          "line and pick its Store item (add the item in Store › Item Master first if it's new), then use Raise PR.",
          error: true);
      return;
    }
    final params = Uri(queryParameters: {
      'store_item_id': str(i['store_item_id']),
      'make': str(i['make']),
      'quantity': ((asNum(i['quantity']) ?? 1).ceil()).toString(),
      'remarks': 'Electrical BOM line ${i['line_no']} for $jobNo (${job['title']}).',
    }).query;
    runAction(context, () => Files.openInPortal('/dashboard/p2p/new?$params'));
  }

  Future<void> _delete(Json i) async {
    final ok = await confirmDialog(context,
        title: 'Delete BOM line?',
        message: "Remove line ${i['line_no']} (${i['description']}) from $jobNo's BOM?",
        confirmLabel: 'Delete',
        danger: true);
    if (ok) {
      await _mutate(() => Api.delete('/electrical/jobs/$jobId/bom/${i['id']}'), success: 'BOM line ${i['line_no']} deleted.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = _isOpen && Elec.jf('bom', 'create');
    final canRemove = _isOpen && Elec.jf('bom', 'delete');
    final canSubmit = Elec.jf('bom', 'submit');
    final canRaisePr = Elec.hasApp('p2p');
    final toBuy = _items.where((i) => i['procurement_status'] == 'required').length;
    final cost = _items.fold<num>(0, (s, i) => s + (asNum(i['quantity']) ?? 0) * (asNum(i['estimated_unit_cost']) ?? 0));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Electrical BOM',
            summary: Text.rich(
              TextSpan(children: [
                TextSpan(text: '${_items.length} ${plural(_items.length, 'line')} · '),
                TextSpan(
                    text: '$toBuy to buy',
                    style: TextStyle(color: toBuy > 0 ? cRed : Brand.muted, fontWeight: toBuy > 0 ? FontWeight.w600 : null)),
                if (_seeCosts) ...[
                  const TextSpan(text: ' · Est. cost '),
                  TextSpan(text: fmtMoney(cost), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                ],
              ]),
              style: const TextStyle(fontSize: 12, color: Brand.muted),
            ),
            action: canAdd ? primaryBtn('Add Component', _busy ? null : () => _openForm()) : null,
          ),
          if (widget.canEdit)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Muted(
                '${canRaisePr ? 'Use "Raise PR" on a To Buy line to open a pre-filled purchase requisition; once it is submitted, come back and use "Link PR" with its PR number.' : 'Once Procurement raises a purchase requisition for a line, use "Link PR" to attach its PR number.'}'
                ' Mark a line Selected only after entering its make and part number.',
                size: 12,
              ),
            ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (!_loaded)
            const LoadingView()
          else if (_items.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted("No components on this job's BOM yet.${widget.canEdit ? ' Use "+ Add Component" to start the list.' : ''}",
                  size: 13),
            )
          else
            for (final i in _items) _line(i, canSubmit, canRaisePr, canRemove),
        ],
      ),
    );
  }

  Widget _line(Json i, bool canSubmit, bool canRaisePr, bool canRemove) {
    final hasApproval = asInt(i['approval_request_id']) != null;
    final sub = [str(i['store_item_code']), str(i['rating'])].where((s) => s.isNotEmpty).join(' · ');
    return ItemCard(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('#${i['line_no']} · ${widget.meta.componentCategories[str(i['category'])] ?? str(i['category'])}',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                  Text(str(i['description']),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading)),
                  if (sub.isNotEmpty) Muted(sub, size: 12),
                ],
              ),
            ),
          ],
        ),
        MetaWrap([
          ('Make / Part No.', str(i['make']).isEmpty && str(i['part_number']).isEmpty
              ? '—'
              : '${str(i['make']).isEmpty ? '—' : i['make']} / ${str(i['part_number']).isEmpty ? 'No part number' : i['part_number']}'),
          ('Qty', '${fmtNumber(i['quantity'])} ${str(i['uom'])}'),
          ('Panel', txt(i['panel_tag'])),
        ]),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const Muted('Selection', size: 11),
            pill(i['selection_status'], selectionLabels, selectionHex),
            if (hasApproval)
              InkWell(
                onTap: () => _review(i),
                child: const Text('Awaiting approval · Review',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: cOrange)),
              ),
            const SizedBox(width: 4),
            const Muted('Procurement', size: 11),
            pill(i['procurement_status'], procurementLabels, procurementHex),
            if (str(i['p2p_number']).isNotEmpty)
              Muted('${i['p2p_number']}${str(i['p2p_status']).isNotEmpty ? ' · ${humanizeKey(str(i['p2p_status']))}' : ''}',
                  size: 12),
          ],
        ),
        if (widget.canEdit) ...[
          const SizedBox(height: 10),
          btnWrap([
            smallBtn('Edit', _busy ? null : () => _openForm(i)),
            if (i['selection_status'] == 'selected' && !hasApproval && canSubmit)
              smallBtn(
                  'Submit for approval',
                  _busy
                      ? null
                      : () => _mutate(() => Api.post('/electrical/jobs/$jobId/bom/${i['id']}/submit'),
                          success: 'BOM line ${i['line_no']} submitted for approval.')),
            if (asInt(i['p2p_request_id']) != null)
              smallBtn('Unlink PR', _busy ? null : () => _unlink(i))
            else
              smallBtn('Link PR', _busy ? null : () => _link(i)),
            if (i['procurement_status'] == 'required' && canRaisePr) smallBtn('Raise PR', () => _raisePr(i)),
            if (canRemove) smallBtn('Delete', _busy ? null : () => _delete(i), danger: true),
          ]),
        ],
      ],
    );
  }
}