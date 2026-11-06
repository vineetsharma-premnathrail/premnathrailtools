import 'package:dio/dio.dart' show MultipartFile;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';

// New / edit Purchase Requisition (portal app/dashboard/p2p/new/page.tsx):
// Purpose first, then the project it is for, Required date + Priority, then
// item lines picked from the Item Master (type → category → item, by id),
// remarks and a specification file.

const _standardTypes = ['material', 'service', 'asset', 'consumable', 'tool_equipment'];

const _purposeHints = {
  'machine_project':
      'Service work on a project: spares, repair, warranty, commissioning support. Pick the project (any stage); every line is for it.',
  'development': 'New product development (R&D).',
  'department':
      'Day-to-day running cost of a department: cleaning material, stationery, small tools, office repairs, AMC, housekeeping.',
  'capital': 'Something the company owns and uses for years (machine, laptop, AC, welding set).',
  'stock': 'Common items Store keeps in stock (fasteners, oil, gloves).',
};

class _Line {
  _Line({this.id, this.storeItemId, double qty = 1, this.shipTo = '', this.elementId})
      : qty = TextEditingController(text: qtyText(qty)),
        custom = TextEditingController(text: shipTo);
  final int? id;
  int? storeItemId;
  final TextEditingController qty;
  String shipTo;
  bool customShip = false;
  final TextEditingController custom;
  String type = '';
  String category = '';
  int? elementId;
}

/// Opens the requisition form; returns the saved requisition's id.
Future<int?> openPrForm(BuildContext context, {int? editId}) async {
  final data = await withLoading(context, () async {
    final r = await Future.wait([
      Api.get('/p2p/requests/meta'),
      Api.get('/p2p/requests/projects', query: {'include_delivered': true}),
      loadActiveItems(),
      Api.get('/organization/branches').catchError((_) => <dynamic>[]),
      if (editId != null) Api.get('/p2p/requests/$editId'),
    ]);
    return r;
  });
  if (data == null || !context.mounted) return null;
  final meta = asJson(data[0]);
  final purposes = jList(meta, 'purposes');
  final projects = asList(data[1]);
  final master = data[2] as List<Json>;
  final plants = asList(data[3]).where((b) => jStr(b, 'status') != 'inactive').toList();
  final editing = editId != null ? asJson(data[4]) : null;
  if (editing != null && !jBool(editing, 'can_edit')) {
    showSnack(context, jStr(editing, 'edit_block_reason') ?? '${editing['p2p_number']} can no longer be edited.', error: true);
    return null;
  }
  final byId = {for (final i in master) jInt(i, 'id'): i};
  String plantLabel(Json b) => '${b['name']} (${b['code']})';

  // ── State ──
  var purpose = '';
  String? projectId;
  var acctKind = '';
  String? acctId;
  List<Option<int>>? rndProjects;
  String? rndError;
  DateTime? requiredDate;
  var priority = 'standard';
  final remarks = TextEditingController();
  final lines = <_Line>[_Line()];
  final specFiles = <MultipartFile>[];
  final specNames = <String>[];
  var asDraft = false;
  final stock = <int, Object>{}; // id -> Json availability | 'error'

  if (editing != null) {
    final match = projects.where((p) => jStr(p, 'label') == jStr(editing, 'project_label')).toList();
    projectId = match.isEmpty ? null : '${match.first['id']}';
    var kind = jStr(editing, 'account_assignment') ?? '';
    if (kind == 'sales_order' && editing['order_project_id'] != null) kind = 'order_project';
    acctKind = kind;
    final fk = {
      'sales_order': 'sales_order_id',
      'cost_center': 'cost_center_id',
      'work_order': 'work_order_id',
      'internal_order': 'internal_order_id',
      'order_project': 'order_project_id',
      'rnd_project': 'rnd_project_id',
    }[kind];
    acctId = fk != null && editing[fk] != null ? '${editing[fk]}' : null;
    purpose = jStr(editing, 'purpose') ??
        (kind == 'order_project' || kind == 'sales_order'
            ? 'customer_order'
            : kind == 'cost_center'
                ? 'department'
                : match.isNotEmpty
                    ? 'machine_project'
                    : '');
    requiredDate = parseDate(editing['required_date']);
    priority = isUrgent(editing['priority']) ? 'urgent' : 'standard';
    remarks.text = jStr(editing, 'remarks') ?? '';
    final its = jList(editing, 'items');
    if (its.isNotEmpty) {
      lines
        ..clear()
        ..addAll(its.map((it) => _Line(
              id: jInt(it, 'id'),
              storeItemId: jInt(it, 'store_item_id'),
              qty: jD(it, 'quantity'),
              shipTo: jStr(it, 'ship_to') ?? '',
              elementId: jInt(it, 'order_project_element_id'),
            )));
    }
  }

  Json? purposeMeta() => purposes.where((p) => jStr(p, 'code') == purpose).firstOrNull;
  List<String>? allowedTypes() {
    final t = jStrings(purposeMeta(), 'item_types');
    return t.isEmpty ? null : t;
  }

  bool typeFits(String? t) {
    final a = allowedTypes();
    return a == null || !_standardTypes.contains(t ?? '') || a.contains(t ?? '');
  }

  List<String> itemTypeOptions() {
    final present = master.map((i) => jStr(i, 'item_type')).whereType<String>().toSet().toList();
    final a = allowedTypes();
    if (a == null) return present..sort();
    final ordered = a.where((t) => present.isEmpty || present.contains(t)).toList();
    return [...ordered, ...(present.where((t) => !_standardTypes.contains(t)).toList()..sort())];
  }

  String effectiveType(String picked) {
    final opts = itemTypeOptions();
    return opts.contains(picked) ? picked : (opts.length == 1 ? opts.first : '');
  }

  List<String> categoriesForType(String type) => master
      .where((i) => type.isEmpty ? typeFits(jStr(i, 'item_type')) : jStr(i, 'item_type') == type)
      .map((i) => jStr(i, 'category'))
      .whereType<String>()
      .toSet()
      .toList()
    ..sort();

  final rulesApply = editing == null || jStr(editing, 'status') == 'draft';

  List<String> typeMismatches() {
    if (allowedTypes() == null) return const [];
    final out = <String>[];
    for (var i = 0; i < lines.length; i++) {
      final m = byId[lines[i].storeItemId];
      if (m != null && !typeFits(jStr(m, 'item_type'))) {
        out.add('Line ${i + 1} (${m['item_code']} ${m['item_name']}, ${typeLabel(jStr(m, 'item_type') ?? '').toLowerCase()})');
      }
    }
    return out;
  }

  Future<void> loadStock(int id, StateSetter setS) async {
    if (stock.containsKey(id)) return;
    try {
      final rows = asList(await Api.get('/p2p/requests/stock-availability', query: {'item_ids': '$id'}));
      for (final r in rows) {
        stock[jInt(r, 'store_item_id') ?? id] = r;
      }
      stock.putIfAbsent(id, () => 'error');
    } catch (_) {
      stock[id] = 'error';
    }
    try {
      setS(() {});
    } catch (_) {/* sheet closed */}
  }

  Future<void> loadRnd(StateSetter setS) async {
    if (rndProjects != null) return;
    try {
      final r = asJson(await Api.get('/p2p/account-assignment/options', query: {'kind': 'rnd_project'}));
      rndProjects = [for (final o in jList(r, 'options')) Option(jInt(o, 'id') ?? 0, jStr(o, 'label') ?? '')];
    } catch (e) {
      rndError = '${ApiClient.describe(e)} Close the form and open it again to retry.';
    }
    try {
      setS(() {});
    } catch (_) {}
  }

  void pickPurpose(String value, StateSetter setS) {
    final pm = purposes.where((p) => jStr(p, 'code') == value).firstOrNull;
    if (value != purpose) projectId = null;
    purpose = value;
    acctKind = '';
    acctId = null;
    final ok = jStrings(pm, 'item_types');
    if (ok.isNotEmpty) {
      for (final l in lines) {
        if (l.type.isNotEmpty && _standardTypes.contains(l.type) && !ok.contains(l.type)) l.type = '';
      }
    }
    if (value == 'development') loadRnd(setS);
  }

  if (purpose == 'development') {
    // Loaded before the sheet opens on edit.
    try {
      final r = asJson(await Api.get('/p2p/account-assignment/options', query: {'kind': 'rnd_project'}));
      rndProjects = [for (final o in jList(r, 'options')) Option(jInt(o, 'id') ?? 0, jStr(o, 'label') ?? '')];
    } catch (_) {}
  }
  for (final l in lines) {
    if (l.storeItemId != null) {
      try {
        final rows = asList(await Api.get('/p2p/requests/stock-availability', query: {'item_ids': '${l.storeItemId}'}));
        for (final r in rows) {
          stock[jInt(r, 'store_item_id') ?? l.storeItemId!] = r;
        }
      } catch (_) {
        stock[l.storeItemId!] = 'error';
      }
    }
  }
  if (!context.mounted) return null;

  final purposeChoices = purposes
      .where((p) => p['allowed'] != false || (editing != null && jStr(p, 'code') == jStr(editing, 'purpose')))
      .map((p) => Option(jStr(p, 'code') ?? '', jStr(p, 'label') ?? ''))
      .toList();
  final status = jStr(editing, 'status');
  final inApproval = editing != null && (status == 'submitted' || status == 'approved');
  int? savedId;

  final title = editing == null
      ? 'New Purchase Requisition'
      : status == 'draft'
          ? 'Edit Draft ${editing['p2p_number']}'
          : 'Edit Purchase Requisition ${editing['p2p_number']}';

  Widget stockText(Json? m, _Line l) {
    if (m == null) return const Hint('—');
    final st = stock[jInt(m, 'id')];
    if (st == null) return const Hint('Checking…');
    if (st is! Json) return const Hint("Couldn't check — close and open the form to try again.", color: Color(0xFFB45309));
    final avail = jD(st, 'available_qty');
    if (avail <= 0) return const Text('Not in stock', style: TextStyle(color: Color(0xFFB91C1C), fontWeight: FontWeight.w600));
    final short = (double.tryParse(l.qty.text) ?? 0) > avail;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${fmtQty(avail)} ${jStr(m, 'uom') ?? ''} ${short ? 'available (less than asked)' : 'available'}',
          style: TextStyle(color: short ? const Color(0xFFB45309) : const Color(0xFF15803D), fontWeight: FontWeight.w700)),
      for (final loc in jList(st, 'locations'))
        Hint('${jStr(loc, 'plant') != null ? '${loc['plant']} · ' : ''}${loc['store']}: ${fmtQty(loc['available_qty'])}'),
    ]);
  }

  Widget lineCard(int idx, StateSetter setS) {
    final l = lines[idx];
    final m = byId[l.storeItemId];
    final lineType = effectiveType(l.type).isNotEmpty
        ? effectiveType(l.type)
        : (m != null && itemTypeOptions().contains(jStr(m, 'item_type')) ? jStr(m, 'item_type')! : '');
    final lineCategory = l.category.isNotEmpty ? l.category : (m != null && jStr(m, 'item_type') == lineType ? jStr(m, 'category') ?? '' : '');
    final cats = categoriesForType(lineType);
    final categoryReady = lineType.isNotEmpty;
    final itemReady = l.storeItemId != null || (categoryReady && (lineCategory.isNotEmpty || cats.isEmpty));
    final shown = master
        .where((i) =>
            jInt(i, 'id') == l.storeItemId ||
            ((lineType.isNotEmpty ? jStr(i, 'item_type') == lineType : typeFits(jStr(i, 'item_type'))) &&
                (lineCategory.isEmpty || jStr(i, 'category') == lineCategory)))
        .toList();
    final plant = plants.where((b) => plantLabel(b) == l.shipTo).firstOrNull;
    final custom = l.customShip || (l.shipTo.isNotEmpty && plant == null);
    return InnerCard(key: ValueKey('line-$idx-${l.hashCode}'), children: [
      Row(children: [
        Expanded(child: Text('Line ${idx + 1}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
        if (lines.length > 1)
          linkBtn('Remove', () => setS(() => lines.removeAt(idx)), color: Brand.danger),
      ]),
      const SizedBox(height: 8),
      AppSelect<String>(
        label: '1. Item type',
        value: lineType.isEmpty ? null : lineType,
        options: [for (final t in itemTypeOptions()) Option(t, typeLabel(t))],
        onChanged: (o) => setS(() {
          l.type = o?.value ?? '';
          if (!categoriesForType(l.type).contains(l.category)) l.category = '';
        }),
      ),
      const SizedBox(height: 10),
      AppSelect<String>(
        label: categoryReady ? (cats.isEmpty ? 'No categories' : '2. Category') : '2. Category (pick the type first)',
        value: lineCategory.isEmpty ? null : lineCategory,
        enabled: categoryReady && cats.isNotEmpty,
        options: [for (final c in cats) Option(c, c)],
        onChanged: (o) => setS(() => l.category = o?.value ?? ''),
      ),
      const SizedBox(height: 10),
      AppSelect<int>(
        label: itemReady
            ? '3. Item from Item Master (${shown.length})'
            : (categoryReady ? '3. Item (pick the category first)' : '3. Item (pick the type first)'),
        required: true,
        enabled: itemReady,
        value: l.storeItemId,
        valueLabel: m == null ? null : itemLabel(m),
        options: [for (final i in shown) Option(jInt(i, 'id')!, itemLabel(i), subtitle: itemDetail(i))],
        onChanged: (o) => setS(() {
          l.storeItemId = o?.value;
          if (o != null) loadStock(o.value, setS);
        }),
      ),
      if (m != null) ...[
        const SizedBox(height: 10),
        MiniGrid([
          MiniField('Make', jStr(m, 'make')),
          MiniField('Part Code', jStr(m, 'part_number') ?? jStr(m, 'manufacturer_part_number')),
          MiniField('UOM', jStr(m, 'uom')),
          MiniField('In Stock', stockText(m, l)),
        ]),
      ],
      const SizedBox(height: 10),
      AppTextField(
        label: 'Qty',
        required: true,
        controller: l.qty,
        keyboardType: AppTextField.number,
        onChanged: (_) => setS(() {}),
      ),
      const SizedBox(height: 10),
      AppSelect<String>(
        label: 'Ship To',
        value: custom ? '__custom' : (plant != null ? '${plant['id']}' : null),
        valueLabel: custom ? 'Custom address…' : null,
        options: [
          for (final b in plants) Option('${b['id']}', plantLabel(b), subtitle: 'Plant / branch'),
          const Option('__custom', 'Custom address…', subtitle: 'Other'),
        ],
        onChanged: (o) => setS(() {
          if (o?.value == '__custom') {
            l.customShip = true;
            if (plant != null) {
              l.shipTo = '';
              l.custom.text = '';
            }
            return;
          }
          l.customShip = false;
          final b = plants.where((x) => '${x['id']}' == o?.value).firstOrNull;
          l.shipTo = b != null ? plantLabel(b) : '';
        }),
      ),
      if (custom) ...[
        const SizedBox(height: 10),
        AppTextField(
          label: 'Type the delivery address',
          controller: l.custom,
          onChanged: (v) => l.shipTo = v,
        ),
      ],
    ]);
  }

  final saved = await showFormSheet(
    context,
    title: title,
    saveLabel: 'Save',
    builder: (ctx, setS) {
      final pm = purposeMeta();
      final mismatches = typeMismatches();
      return [
        if (editing == null)
          const Hint('Ask for items from the Item Master — approved requisitions go to stock check, then RFQ and PO.'),
        if (inApproval)
          NoteBox(
            'This requisition is ${status == 'approved' ? 'already approved' : 'waiting for approval'}. Saving your changes withdraws that approval: '
            'Submit sends it for approval again, Save as Draft keeps it with you until you submit it.',
            tone: NoteTone.warn,
          ),
        const FormHeading('Purpose & Charging'),
        AppSelect<String>(
          label: 'Purpose',
          required: true,
          value: purpose.isEmpty ? null : purpose,
          options: purposeChoices,
          onChanged: (o) => setS(() => pickPurpose(o?.value ?? '', setS)),
        ),
        if (purpose == 'machine_project' || purpose == 'customer_order') ...[
          AppSelect<String>(
            label: 'Project',
            required: true,
            value: projectId,
            enabled: projects.isNotEmpty,
            options: [for (final p in projects) Option('${p['id']}', jStr(p, 'label') ?? '')],
            onChanged: (o) => setS(() => projectId = o?.value),
          ),
          if (projects.isEmpty)
            Hint(purpose == 'machine_project'
                ? "No project found. Create the machine's project in Project Management first, then it appears here."
                : 'No project found. Create the project in Project Management first, then it appears here.'),
        ],
        if (purpose == 'development') ...[
          AppSelect<int>(
            label: 'R&D project',
            required: true,
            enabled: rndError == null && (rndProjects == null || rndProjects!.isNotEmpty),
            value: acctKind == 'rnd_project' && acctId != null ? int.tryParse(acctId!) : null,
            options: rndProjects ?? const [],
            onChanged: (o) => setS(() {
              acctKind = o == null ? '' : 'rnd_project';
              acctId = o == null ? null : '${o.value}';
            }),
          ),
          if (rndError != null) Hint(rndError!, color: Brand.danger),
          if (rndProjects != null && rndProjects!.isEmpty)
            const Hint(
                'No open R&D project found. Create the prototype / research project in R&D first; handed-over, closed and cancelled projects are not listed.'),
        ],
        if (pm != null && _purposeHints[purpose] != null) Hint(_purposeHints[purpose]!),
        const FormHeading('Request Details'),
        DateField(label: 'Required Date', value: requiredDate, onChanged: (d) => setS(() => requiredDate = d)),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: const [Option('standard', 'Standard'), Option('urgent', 'Urgent')],
          onChanged: (o) => setS(() => priority = o?.value ?? 'standard'),
        ),
        Row(children: [
          const Expanded(child: FormHeading('Item Details')),
          secondaryBtn('Add Item', () => setS(() => lines.add(_Line())), icon: Icons.add_rounded),
        ]),
        if (mismatches.isNotEmpty && allowedTypes() != null)
          NoteBox(
            '${mismatches.join('; ')} ${mismatches.length == 1 ? "isn't" : "aren't"} an item type bought on a '
            '${(jStr(pm, 'label') ?? '').toLowerCase()} requisition (it takes: ${allowedTypes()!.map((t) => typeLabel(t).toLowerCase()).join(', ')}). '
            '${rulesApply ? "Pick another item for ${mismatches.length == 1 ? 'that line' : 'those lines'} or change the purpose — it can't be submitted as it is." : 'This requisition was submitted earlier, so your changes can still be saved; for new lines pick an item of a type the purpose buys.'}',
            tone: NoteTone.warn,
          ),
        for (var i = 0; i < lines.length; i++) lineCard(i, setS),
        const Hint('Item not in the list? Add it in Store › Item Master first, then open this form again.'),
        const FormHeading('Remarks'),
        AppTextField(
          label: 'Remarks',
          controller: remarks,
          maxLines: 3,
          hint: 'Why it is needed, references, anything the buyer should know…',
        ),
        const FormHeading('Attachments'),
        Row(children: [
          const Expanded(child: Text('Specification / reference file')),
          secondaryBtn('Attach files', () async {
            final picked = await Files.pickFiles();
            for (final f in picked) {
              specFiles.add(f);
              specNames.add(f.filename ?? 'file');
            }
            try {
              setS(() {});
            } catch (_) {}
          }, icon: Icons.attach_file_rounded),
        ]),
        for (var i = 0; i < specNames.length; i++)
          Row(children: [
            const Icon(Icons.insert_drive_file_outlined, size: 18, color: Brand.muted),
            const SizedBox(width: 6),
            Expanded(child: Text(specNames[i], overflow: TextOverflow.ellipsis)),
            IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.close_rounded, size: 18),
              onPressed: () => setS(() {
                specFiles.removeAt(i);
                specNames.removeAt(i);
              }),
            ),
          ]),
        const FormHeading('When I save'),
        SegmentedButton<bool>(
          segments: [
            ButtonSegment(
                value: false,
                label: Text(editing != null && status != 'draft' ? 'Save & Submit for Approval' : 'Submit Purchase Requisition')),
            const ButtonSegment(value: true, label: Text('Save as Draft')),
          ],
          selected: {asDraft},
          onSelectionChanged: (s) => setS(() => asDraft = s.first),
        ),
        if (asDraft) const Hint('A draft is private to you — nobody is asked to approve it until you submit it.'),
      ];
    },
    onSave: () async {
      if (asDraft) {
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].storeItemId != null && !((double.tryParse(lines[i].qty.text) ?? 0) > 0)) {
            throw 'Line ${i + 1}: quantity must be more than 0.';
          }
        }
      } else {
        final pm = purposeMeta();
        if (pm == null) throw 'Choose the purpose of this requisition: what is it being bought for?';
        if ((purpose == 'machine_project' || purpose == 'customer_order') && projectId == null) {
          throw 'Pick the project this requisition is for.';
        }
        if (purpose == 'development' && !(acctKind == 'rnd_project' && acctId != null)) {
          throw 'Pick the R&D project this development is for. If it is not listed, create it in R&D › Prototype / Research first.';
        }
        for (var i = 0; i < lines.length; i++) {
          final m = byId[lines[i].storeItemId];
          if (m == null) {
            throw "Line ${i + 1}: pick the item from the Item Master. If it's a new item, add it first in Store › Item Master, then open the form again.";
          }
          if (!((double.tryParse(lines[i].qty.text) ?? 0) > 0)) {
            throw 'Line ${i + 1} (${m['item_code']} ${m['item_name']}): quantity must be more than 0.';
          }
        }
        final mm = typeMismatches();
        if (rulesApply && mm.isNotEmpty) {
          throw "${mm.join('; ')} ${mm.length == 1 ? "isn't" : "aren't"} an item type bought on a ${(jStr(pm, 'label') ?? '').toLowerCase()} requisition "
              '(it takes: ${allowedTypes()!.map((t) => typeLabel(t).toLowerCase()).join(', ')}). Pick another item for '
              '${mm.length == 1 ? 'that line' : 'those lines'}, or change the purpose.';
        }
      }
      final inhouse = jStr(purposeMeta(), 'line_project_mode') == 'inhouse';
      const fks = {
        'sales_order': 'sales_order_id',
        'cost_center': 'cost_center_id',
        'work_order': 'work_order_id',
        'internal_order': 'internal_order_id',
        'order_project': 'order_project_id',
        'rnd_project': 'rnd_project_id',
      };
      final payload = <String, dynamic>{
        'save_as_draft': asDraft,
        'purpose': purpose.isEmpty ? null : purpose,
        'project_label': (purpose == 'machine_project' || purpose == 'customer_order')
            ? jStr(projects.where((p) => '${p['id']}' == projectId).firstOrNull, 'label')
            : null,
        'account_assignment': acctKind.isEmpty ? null : acctKind,
        for (final e in fks.entries) e.value: e.key == acctKind && acctId != null ? int.tryParse(acctId!) : null,
        'required_date': requiredDate == null ? null : apiDate(requiredDate!),
        'priority': priority,
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        'items': [
          for (final l in lines)
            if (!asDraft || l.storeItemId != null)
              {
                if (l.id != null) 'id': l.id,
                'store_item_id': l.storeItemId,
                'quantity': double.tryParse(l.qty.text) ?? 0,
                'project_inhouse': inhouse ? 'Inhouse' : 'Project',
                if (l.shipTo.trim().isNotEmpty) 'ship_to': l.shipTo.trim(),
                'order_project_element_id': l.elementId,
              },
        ],
      };
      payload.removeWhere((k, v) => v == null && (k == 'required_date' || k == 'remarks'));
      final pr = asJson(editing != null
          ? await Api.put('/p2p/requests/${editing['id']}', data: payload)
          : await Api.post('/p2p/requests', data: payload));
      savedId = jInt(pr, 'id');
      if (specFiles.isNotEmpty && savedId != null) {
        try {
          await Api.post('/p2p/requests/$savedId/attachments',
              data: formData({'files': specFiles, 'doc_type': 'specification'}));
        } catch (e) {
          if (context.mounted) {
            showSnack(
                context,
                'Purchase Requisition ${pr['p2p_number']} was ${asDraft ? 'saved' : editing != null ? 'updated' : 'created'}, '
                'but ${specFiles.length} file(s) failed to upload: ${ApiClient.describe(e)} Open the requisition and add them again.',
                error: true);
          }
        }
      }
    },
  );
  return saved ? savedId : null;
}
