import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_common.dart';
import 'hyd_panels.dart';

// Portal: /dashboard/hydraulic/components (+ /new, /[id]) and components/hydraulic/ComponentForm.tsx.

const _statusLabels = {'active': 'Active', 'obsolete': 'Obsolete'};
const _statusHex = {'active': '#16A34A', 'obsolete': '#78716c'};

/// One-line rating summary per category (portal ratingSummary).
String _ratingSummary(Json c) {
  final parts = <String>[];
  final bore = toNum(c['bore_mm']);
  if (bore != null && bore != 0) {
    final rod = toNum(c['rod_mm']);
    final stroke = toNum(c['stroke_mm']);
    parts.add('Ø$bore${rod != null && rod != 0 ? '/$rod' : ''}${stroke != null && stroke != 0 ? ' × $stroke' : ''} mm');
  }
  final disp = toNum(c['displacement_cc']);
  if (disp != null && disp != 0) parts.add('$disp cc/rev');
  final flow = toNum(c['flow_rate_lpm']);
  if (flow != null && flow != 0) parts.add('$flow L/min');
  final p = toNum(c['rated_pressure_bar']);
  if (p != null && p != 0) parts.add('$p bar');
  if (parts.isEmpty && (c['port_size'] as String?)?.isNotEmpty == true) parts.add(c['port_size'] as String);
  return parts.isEmpty ? '—' : parts.join(' · ');
}

String _makeModel(Json c) {
  final s = [c['manufacturer'], c['model_number']].whereType<String>().where((s) => s.isNotEmpty).join(' ');
  return s.isEmpty ? '—' : s;
}

class HydComponentsList extends StatefulWidget {
  const HydComponentsList({super.key});

  @override
  State<HydComponentsList> createState() => _HydComponentsListState();
}

class _HydComponentsListState extends State<HydComponentsList> {
  final _list = GlobalKey<ApiListViewState>();
  String _category = '';
  String _medium = '';
  String _status = 'active';
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
      floatingActionButton: hydCan('components', 'create')
          ? CreateFab(
              label: 'New Component',
              onPressed: () async {
                await openComponentForm(context);
                _list.currentState?.reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search code, name, make, model or part no…',
        load: (page, search) async {
          final p = await Api.list('/hydraulic/components',
              query: {'category': _category, 'system_type': _medium, 'status': _status, 'search': search});
          if (mounted) setState(() => _count = p.rows.length);
          return p;
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Component Master', subtitle: 'Hydraulic & Pneumatic'),
          FilterBar(children: [
            FilterPill(
                label: 'Category',
                value: _category,
                allLabel: 'All categories',
                options: componentCategoryLabels,
                onChanged: (v) => _refilter(() => _category = v)),
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
                options: _statusLabels,
                onChanged: (v) => _refilter(() => _status = v)),
          ]),
          if (_count != null) RowCountLine(_count!),
        ]),
        emptyText: 'No components match. Add the pumps, valves, cylinders and fittings your circuits and BOMs use.',
        itemBuilder: (ctx, c, reload) {
          final used = toInt(c['bom_usage_count']) ?? 0;
          return RecordCard(
            code: txt(c['code']),
            title: txt(c['name']),
            subtitle: lbl(componentCategoryLabels, c['category']),
            trailing: Padding(padding: const EdgeInsets.only(left: 8), child: pill(_statusLabels, _statusHex, c['status'])),
            meta: [
              ('Medium', lbl(mediaTypeLabels, c['system_type'])),
              ('Make / Model', _makeModel(c)),
              ('Rating', _ratingSummary(c)),
              if (seeCosts) ('Unit Cost', inr(c['unit_cost'])),
              ('Used In', used > 0 ? '$used BOM${used > 1 ? 's' : ''}' : '—'),
            ],
            onTap: () async {
              await pushPage(ctx, HydComponentDetail(id: toInt(c['id'])!));
              reload();
            },
          );
        },
      ),
    );
  }
}

class _Spec {
  _Spec(this.label, this.value) : key = ++_seq;
  static int _seq = 0;
  final int key;
  String label;
  String value;
}

const _signedNumber = TextInputType.numberWithOptions(decimal: true, signed: true);

/// New / edit component (portal ComponentForm). Returns the saved record.
Future<Json?> openComponentForm(BuildContext context, {Json? initial}) async {
  final i = initial ?? const <String, dynamic>{};
  final seeCosts = hydSeeCosts();
  var name = (i['name'] ?? '') as String;
  var category = (i['category'] ?? 'pump') as String;
  var systemType = (i['system_type'] ?? 'hydraulic') as String;
  var status = (i['status'] ?? 'active') as String;
  var manufacturer = (i['manufacturer'] ?? '') as String;
  var modelNumber = (i['model_number'] ?? '') as String;
  var partNumber = (i['part_number'] ?? '') as String;
  int? storeItemId = toInt(i['store_item_id']);
  String? storeItemLabel = i['store_item_code'] == null
      ? null
      : '${i['store_item_code']}${i['store_item_name'] != null ? ' — ${i['store_item_name']}' : ''}';
  final ratings = {for (final k in ratingFields.keys) k: numStr(i[k])};
  var media = (i['media'] ?? '') as String;
  var tempMin = numStr(i['temp_min_c']);
  var tempMax = numStr(i['temp_max_c']);
  var weight = numStr(i['weight_kg']);
  var unitCost = numStr(i['unit_cost'] ?? 0);
  var datasheetUrl = (i['datasheet_url'] ?? '') as String;
  var description = (i['description'] ?? '') as String;
  final specs = [
    for (final s in (i['specifications'] as List? ?? const []).whereType<Map>())
      _Spec((s['label'] ?? '').toString(), (s['value'] ?? '').toString()),
  ];
  Json? saved;

  final ok = await showFormSheet(
    context,
    title: initial == null ? 'New Component' : 'Edit ${i['code']}',
    saveLabel: initial == null ? 'Create Component' : 'Save Changes',
    builder: (ctx, setS) {
      final visible = categoryFields[category] ?? defaultCategoryFields;
      return [
        if (initial == null)
          const Hint('A pump, valve, cylinder or other part in the component master — BOMs and tests pick from it.'),
        const FormHeading('Identity'),
        if (initial != null)
          ReadOnlyField(label: 'Category *', value: lbl(componentCategoryLabels, category))
        else
          AppSelect<String>(
              label: 'Category',
              required: true,
              value: category,
              options: optionsOf(componentCategoryLabels),
              onChanged: (o) => setS(() => category = o?.value ?? category)),
        AppTextField(label: 'Name', required: true, initialValue: name, hint: 'Gear pump 28 cc/rev', onChanged: (v) => name = v),
        TwoUp(
          AppSelect<String>(
              label: 'Medium',
              required: true,
              value: systemType,
              options: optionsOf(mediaTypeLabels),
              onChanged: (o) => setS(() => systemType = o?.value ?? systemType)),
          AppSelect<String>(
              label: 'Status',
              required: true,
              value: status,
              options: optionsOf(_statusLabels),
              onChanged: (o) => setS(() => status = o?.value ?? status)),
        ),
        if (initial == null)
          const Hint("The code is generated from the category (e.g. PMP-0001) and the category can't be changed later."),
        const FormHeading('Make & Stock'),
        AppTextField(
            label: 'Manufacturer',
            initialValue: manufacturer,
            hint: 'Bosch Rexroth, Parker, Festo…',
            onChanged: (v) => manufacturer = v),
        TwoUp(
          AppTextField(label: 'Model Number', initialValue: modelNumber, onChanged: (v) => modelNumber = v),
          AppTextField(label: 'Part / Order Number', initialValue: partNumber, onChanged: (v) => partNumber = v),
        ),
        AppSelect<int>(
          label: 'Linked Store Item',
          value: storeItemId,
          valueLabel: storeItemLabel,
          loadOptions: hydLookup('/hydraulic/lookups/store-items'),
          onChanged: (o) => setS(() {
            storeItemId = o?.value;
            storeItemLabel = o?.label;
          }),
        ),
        if (seeCosts) ...[
          AppTextField(
              label: 'Unit Cost (₹)', initialValue: unitCost, keyboardType: AppTextField.number, onChanged: (v) => unitCost = v),
          const Hint('Unit cost drives BOM cost roll-ups.'),
        ],
        FormHeading('Ratings — ${lbl(componentCategoryLabels, category)}'),
        for (final k in visible)
          AppTextField(
            key: ValueKey('rating-$k'),
            label: ratingFields[k]!.$2.isEmpty ? ratingFields[k]!.$1 : '${ratingFields[k]!.$1} (${ratingFields[k]!.$2})',
            initialValue: ratings[k],
            hint: k == 'port_size' ? 'G 1/2, SAE 16…' : null,
            keyboardType: ratingFields[k]!.$3 ? null : AppTextField.number,
            onChanged: (v) => ratings[k] = v,
          ),
        AppTextField(
            label: 'Medium / Fluid',
            initialValue: media,
            hint: 'Mineral oil HLP 46, compressed air…',
            onChanged: (v) => media = v),
        TwoUp(
          AppTextField(label: 'Min Temp (°C)', initialValue: tempMin, keyboardType: _signedNumber, onChanged: (v) => tempMin = v),
          AppTextField(label: 'Max Temp (°C)', initialValue: tempMax, keyboardType: _signedNumber, onChanged: (v) => tempMax = v),
        ),
        AppTextField(label: 'Weight (kg)', initialValue: weight, keyboardType: AppTextField.number, onChanged: (v) => weight = v),
        FormHeading('Other Specifications (${specs.length}) — optional',
            trailing: IconButton(
              tooltip: 'Add Spec',
              icon: const Icon(Icons.add_box_outlined),
              onPressed: () => setS(() => specs.add(_Spec('', ''))),
            )),
        if (specs.isEmpty)
          const Hint('Anything not covered above — solenoid voltage, spool type, filtration ratio, cracking pressure…'),
        for (final s in specs)
          Row(
            key: ValueKey('spec-${s.key}'),
            children: [
              Expanded(
                  child: AppTextField(
                      label: 'Label', initialValue: s.label, hint: 'Filtration ratio', onChanged: (v) => s.label = v)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: 'Value', initialValue: s.value, hint: 'β10 ≥ 200', onChanged: (v) => s.value = v)),
              IconButton(
                tooltip: 'Remove specification',
                icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFB91C1C)),
                onPressed: () => setS(() => specs.remove(s)),
              ),
            ],
          ),
        AppTextField(
            label: 'Datasheet Link (optional)',
            initialValue: datasheetUrl,
            hint: 'https://…',
            keyboardType: TextInputType.url,
            onChanged: (v) => datasheetUrl = v),
        AppTextField(label: 'Description (optional)', maxLines: 3, initialValue: description, onChanged: (v) => description = v),
      ];
    },
    onSave: () async {
      if (name.trim().isEmpty) throw 'Component name is required.';
      final visible = categoryFields[category] ?? defaultCategoryFields;
      final numbers = <String, num?>{};
      for (final k in visible) {
        final (label, _, isText) = ratingFields[k]!;
        if (isText) continue;
        final raw = ratings[k]!.trim();
        final n = raw.isEmpty ? null : num.tryParse(raw);
        if (raw.isNotEmpty && (n == null || n < 0)) throw '$label must be a positive number.';
        numbers[k] = n;
      }
      final bore = numbers['bore_mm'];
      final rod = numbers['rod_mm'];
      if (bore != null && bore != 0 && rod != null && rod != 0 && rod >= bore) {
        throw 'Rod diameter must be smaller than the bore.';
      }
      final cost = num.tryParse(unitCost.trim().isEmpty ? '0' : unitCost.trim());
      if (cost == null || cost < 0) throw 'Unit cost must be zero or more.';
      if (specs.any((s) => s.label.trim().isEmpty && s.value.trim().isNotEmpty)) {
        throw 'Every extra specification needs a label — remove empty rows.';
      }
      for (final (v, label) in [(tempMin, 'Min temperature'), (tempMax, 'Max temperature'), (weight, 'Weight')]) {
        if (v.trim().isNotEmpty && num.tryParse(v.trim()) == null) throw '$label must be a number.';
      }
      final ratingPayload = <String, dynamic>{};
      for (final k in ratingFields.keys) {
        if (!visible.contains(k)) {
          ratingPayload[k] = null;
          continue;
        }
        ratingPayload[k] = ratingFields[k]!.$3 ? blankToNull(ratings[k]!) : numbers[k];
      }
      final payload = {
        if (initial == null) 'category': category,
        'name': name.trim(),
        'system_type': systemType,
        'status': status,
        'manufacturer': blankToNull(manufacturer),
        'model_number': blankToNull(modelNumber),
        'part_number': blankToNull(partNumber),
        'store_item_id': storeItemId,
        ...ratingPayload,
        'media': blankToNull(media),
        'temp_min_c': numOrNull(tempMin),
        'temp_max_c': numOrNull(tempMax),
        'weight_kg': numOrNull(weight),
        'unit_cost': cost,
        'datasheet_url': blankToNull(datasheetUrl),
        'description': blankToNull(description),
        'specifications': [
          for (final s in specs)
            if (s.label.trim().isNotEmpty) {'label': s.label.trim(), 'value': s.value.trim()},
        ],
      };
      final r = initial == null
          ? await Api.post('/hydraulic/components', data: payload)
          : await Api.patch('/hydraulic/components/${i['id']}', data: payload);
      saved = asJson(r);
    },
  );
  if (!ok || saved == null) return null;
  if (initial == null && context.mounted) openScreen(context, HydComponentDetail(id: toInt(saved!['id'])!));
  return saved;
}

class HydComponentDetail extends StatelessWidget {
  const HydComponentDetail({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context) {
    final seeCosts = hydSeeCosts();
    return HydDetail(
      fallbackTitle: 'Component',
      load: () async => asJson(await Api.get('/hydraulic/components/$id')),
      title: (c) => txt(c['code']),
      actions: (ctx, c, ctl) => [
        if (hydCan('components', 'edit'))
          secondaryBtn('Edit', () async {
            final r = await openComponentForm(ctx, initial: c);
            if (r != null) {
              ctl.setRecord(r);
              if (ctx.mounted) showSnack(ctx, 'Component saved.');
            }
          }),
        if (hydCanDelete('components', c['created_by_id']))
          dangerBtn('Delete', () async {
            final yes = await confirmDialog(ctx,
                title: 'Delete component?',
                message:
                    '${c['code']} will be removed from the component master and pickers. Released BOMs and past tests keep their history.',
                confirmLabel: 'Delete',
                danger: true);
            if (!yes || !ctx.mounted) return;
            if (await ctl.run(ctx, () => Api.delete('/hydraulic/components/$id'), success: 'Component deleted.') &&
                ctx.mounted) {
              Navigator.pop(ctx);
            }
          }),
      ],
      sections: (ctx, c, ctl) {
        final used = toInt(c['bom_usage_count']) ?? 0;
        final specs = (c['specifications'] as List? ?? const []).whereType<Map>().toList();
        final url = c['datasheet_url'] as String?;
        return [
          SummaryCard(
            eyebrow: 'Hydraulic & Pneumatic · Component',
            title: txt(c['name']),
            text: c['description'] as String?,
            badges: [
              pill(_statusLabels, _statusHex, c['status'] == 'obsolete' ? 'obsolete' : 'active'),
              StatusBadge(lbl(componentCategoryLabels, c['category']), color: hx('#0369a1')),
              pill(mediaTypeLabels, systemTypeHex, c['system_type']),
            ],
            meta: '· ${used > 0 ? 'Used on $used BOM${used == 1 ? '' : 's'}' : 'Not on any BOM yet'}',
          ),
          if (url != null && url.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: linkBtn('Open datasheet ↗', () => runAction(ctx, () => Files.openUrl(url))),
              ),
            ),
          DetailSection('Make & purchase', children: [
            FieldRow('Manufacturer', c['manufacturer']),
            FieldRow('Model number', c['model_number']),
            FieldRow('Part / order number', c['part_number']),
            FieldRow(
                'Linked store item',
                c['store_item_code'] != null
                    ? '${c['store_item_code']}${c['store_item_name'] != null ? ' — ${c['store_item_name']}' : ''}'
                    : 'Not stocked in Store'),
            if (seeCosts) FieldRow('Unit cost', inr(c['unit_cost'] ?? 0)),
          ]),
          DetailSection('Ratings', children: [
            for (final k in categoryFields[c['category']] ?? defaultCategoryFields)
              FieldRow(
                  ratingFields[k]!.$1,
                  c[k] == null || c[k] == ''
                      ? null
                      : '${c[k]}${ratingFields[k]!.$2.isNotEmpty ? ' ${ratingFields[k]!.$2}' : ''}'),
            FieldRow('Medium / fluid', c['media']),
            FieldRow(
                'Temperature range',
                c['temp_min_c'] != null || c['temp_max_c'] != null
                    ? '${c['temp_min_c'] ?? '—'} to ${c['temp_max_c'] ?? '—'} °C'
                    : null),
            FieldRow('Weight', c['weight_kg'] != null ? '${c['weight_kg']} kg' : null),
          ]),
          if (specs.isNotEmpty)
            DetailSection('Other specifications', children: [
              for (final s in specs) FieldRow(txt(s['label']), s['value']),
            ]),
          const SizedBox.shrink(),
          HydDocumentsPanel(entityType: 'component', entityId: id, title: 'Datasheets & Drawings', defaultDocType: 'datasheet'),
        ];
      },
    );
  }
}
