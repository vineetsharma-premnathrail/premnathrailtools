// Cables tab - phone copy of frontend/src/components/electrical/CablesTab.tsx:
// the cable schedule (Cable / Wiring Design) and moving cables through
// cut → harnessed → installed → terminated → tested, often a harness at a time.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _installed = ['installed', 'terminated', 'tested'];

class CablesTab extends StatefulWidget {
  const CablesTab({super.key, required this.job, required this.canEdit, required this.onChanged});
  final Json job;
  final bool canEdit;
  final VoidCallback onChanged;

  @override
  State<CablesTab> createState() => _CablesTabState();
}

class _CablesTabState extends State<CablesTab> {
  List<Json> _cables = [];
  bool _loaded = false;
  String? _error;
  bool _busy = false;
  String _q = '';
  String _status = '';
  String _harness = '';
  final Set<int> _selected = {};
  String? _bulkStatus;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  bool get _isOpen => workingStatuses.contains(str(job['status']));

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/cables'));
      if (!mounted) return;
      setState(() {
        _cables = rows;
        final ids = rows.map((c) => asInt(c['id'])).toSet();
        _selected.removeWhere((id) => !ids.contains(id));
        _error = null;
        _loaded = true;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not load the cable schedule for $jobNo. ${ApiClient.describe(e)}';
          _loaded = true;
        });
      }
    }
  }

  Future<bool> _mutate(Future<dynamic> Function() fn, String success) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Json> get _visible {
    final q = _q.trim().toLowerCase();
    return _cables.where((c) {
      if (_status.isNotEmpty && c['status'] != _status) return false;
      if (_harness == '__none__') {
        if (str(c['harness_ref']).isNotEmpty) return false;
      } else if (_harness.isNotEmpty && c['harness_ref'] != _harness) {
        return false;
      }
      if (q.isEmpty) return true;
      return [c['cable_tag'], c['circuit'], c['from_point'], c['to_point'], c['harness_ref']]
          .any((v) => str(v).toLowerCase().contains(q));
    }).toList();
  }

  String _spec(Json c) {
    final cores = asInt(c['cores']);
    final size = asNum(c['size_sqmm']);
    if (cores != null && size != null) return '$cores × ${fmtNumber(size)} mm²';
    if (cores != null) return '$cores core';
    if (size != null) return '${fmtNumber(size)} mm²';
    return '';
  }

  Future<void> _openForm([Json? editing]) async {
    TextEditingController t(String k) => TextEditingController(text: str(editing?[k]));
    final tag = t('cable_tag'), circuit = t('circuit'), harness = t('harness_ref'), from = t('from_point');
    final to = t('to_point'), type = t('cable_type'), cores = t('cores'), size = t('size_sqmm'), length = t('length_m');
    final voltage = t('voltage_rating'), colour = t('color_code'), remarks = t('remarks');
    var status = editing == null ? 'designed' : str(editing['status']);

    final ok = await showFormSheet(
      context,
      title: editing == null ? 'Add Cable' : 'Edit Cable ${editing['cable_tag']}',
      saveLabel: editing == null ? 'Add Cable' : 'Save Changes',
      builder: (ctx, setS) => [
        Muted(editing == null
            ? "New cable in $jobNo's cable schedule."
            : '${editing['from_point']} → ${editing['to_point']} — $jobNo'),
        const FormHeading('Cable & Circuit'),
        AppTextField(label: 'Cable Tag', controller: tag, required: true, hint: 'W-101'),
        AppTextField(label: 'Circuit', controller: circuit, hint: 'e.g. Headlamp LH'),
        AppTextField(label: 'Harness Ref', controller: harness, hint: 'H-01'),
        const FormHeading('Route'),
        AppTextField(label: 'From', controller: from, required: true, hint: 'e.g. MCP-01 / X1:5'),
        AppTextField(label: 'To', controller: to, required: true, hint: 'e.g. Headlamp LH'),
        const FormHeading('Cable Specification'),
        AppTextField(label: 'Cable Type', controller: type, hint: 'e.g. FRLS PVC, multi-strand Cu'),
        AppTextField(label: 'Cores', controller: cores, keyboardType: TextInputType.number),
        AppTextField(label: 'Size mm²', controller: size, keyboardType: AppTextField.number),
        AppTextField(label: 'Length m', controller: length, keyboardType: AppTextField.number),
        AppTextField(label: 'Voltage Rating', controller: voltage, hint: '1.1 kV'),
        AppTextField(label: 'Colour Code', controller: colour, hint: 'Red / Black'),
        const FormHeading('Status'),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: optionsOf(cableStatusLabels),
          onChanged: (o) => setS(() => status = o?.value ?? status),
        ),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 2),
      ],
      onSave: () async {
        final problems = <String>[];
        if (tag.text.trim().isEmpty) problems.add('Enter a cable tag (e.g. W-101).');
        if (from.text.trim().isEmpty) problems.add('Enter where the cable runs from.');
        if (to.text.trim().isEmpty) problems.add('Enter where the cable runs to.');
        final c = numOrNull(cores.text), s = numOrNull(size.text), l = numOrNull(length.text);
        if (cores.text.trim().isNotEmpty && (c == null || c != c.roundToDouble() || c < 1 || c > 200)) {
          problems.add('Cores must be a whole number from 1 to 200.');
        }
        if (size.text.trim().isNotEmpty && (s == null || s <= 0)) problems.add('Size (mm²) must be greater than 0.');
        if (length.text.trim().isNotEmpty && (l == null || l <= 0)) problems.add('Length (m) must be greater than 0.');
        if (problems.isNotEmpty) throw problems.join(' ');
        final payload = {
          'cable_tag': tag.text.trim(),
          'circuit': strOrNull(circuit.text),
          'from_point': from.text.trim(),
          'to_point': to.text.trim(),
          'cable_type': strOrNull(type.text),
          'cores': c?.toInt(),
          'size_sqmm': s,
          'length_m': l,
          'voltage_rating': strOrNull(voltage.text),
          'color_code': strOrNull(colour.text),
          'harness_ref': strOrNull(harness.text),
          'status': status,
          'remarks': strOrNull(remarks.text),
        };
        if (editing == null) {
          await Api.post('/electrical/jobs/$jobId/cables', data: payload);
        } else {
          await Api.patch('/electrical/jobs/$jobId/cables/${editing['id']}', data: payload);
        }
      },
    );
    final tagText = tag.text.trim().toUpperCase();
    for (final ctrl in [tag, circuit, harness, from, to, type, cores, size, length, voltage, colour, remarks]) {
      ctrl.dispose();
    }
    if (ok) {
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, editing == null ? 'Cable $tagText added.' : 'Cable $tagText updated.');
    }
  }

  Future<void> _delete(Json c) async {
    final ok = await confirmDialog(context,
        title: 'Delete cable?',
        message: "Remove cable ${c['cable_tag']} (${c['from_point']} → ${c['to_point']}) from $jobNo's cable schedule?",
        confirmLabel: 'Delete',
        danger: true);
    if (ok) await _mutate(() => Api.delete('/electrical/jobs/$jobId/cables/${c['id']}'), 'Cable ${c['cable_tag']} deleted.');
  }

  Future<void> _applyBulk(List<int> ids) async {
    final st = _bulkStatus;
    if (st == null || ids.isEmpty) return;
    final label = cableStatusLabels[st] ?? st;
    final ok = await _mutate(
        () => Api.post('/electrical/jobs/$jobId/cables/bulk-status', data: {'cable_ids': ids, 'status': st}),
        '${ids.length} ${plural(ids.length, 'cable')} moved to $label.');
    if (ok && mounted) {
      setState(() {
        _selected.clear();
        _bulkStatus = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = _isOpen && Elec.jf('cables', 'create');
    final canRemove = _isOpen && Elec.jf('cables', 'delete');
    final harnesses = _cables.map((c) => str(c['harness_ref'])).where((h) => h.isNotEmpty).toSet().toList()..sort();
    final visible = _visible;
    final visibleIds = visible.map((c) => asInt(c['id'])!).toList();
    final selectedVisible = _selected.where(visibleIds.contains).toList();
    final allSelected = visible.isNotEmpty && selectedVisible.length == visible.length;
    final installed = _cables.where((c) => _installed.contains(c['status'])).length;
    final totalLength = visible.fold<num>(0, (s, c) => s + (asNum(c['length_m']) ?? 0));
    final filtered = _q.trim().isNotEmpty || _status.isNotEmpty || _harness.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Cable Schedule',
            summary: Muted('$installed of ${_cables.length} installed', size: 12),
            action: canAdd ? primaryBtn('Add Cable', _busy ? null : () => _openForm()) : null,
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          SearchField(hint: 'Tag, circuit, from / to, harness…', onChanged: (v) => setState(() => _q = v)),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'Status',
                value: _status,
                clearable: false,
                options: [const Option('', 'All statuses'), ...optionsOf(cableStatusLabels)],
                onChanged: (o) => setState(() => _status = o?.value ?? ''),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<String>(
                label: 'Harness',
                value: _harness,
                clearable: false,
                options: [
                  const Option('', 'All harnesses'),
                  const Option('__none__', '— No harness —'),
                  for (final h in harnesses) Option(h, h),
                ],
                onChanged: (o) => setState(() => _harness = o?.value ?? ''),
              ),
            ),
          ]),
          Row(children: [
            Expanded(
              child: Muted('${filtered ? 'Filtered from ${_cables.length} · ' : ''}Total length ${fmtNumber(totalLength)} m',
                  size: 12),
            ),
            if (filtered)
              TextButton(
                onPressed: () => setState(() {
                  _status = '';
                  _harness = '';
                }),
                child: const Text('Clear'),
              ),
          ]),
          if (widget.canEdit && visible.isNotEmpty)
            CheckField(
              label: 'Select all shown cables',
              value: allSelected,
              onChanged: (v) => setState(() {
                if (allSelected) {
                  _selected.removeAll(visibleIds);
                } else {
                  _selected.addAll(visibleIds);
                }
              }),
            ),
          if (widget.canEdit && selectedVisible.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: NoteBox(
                '',
                color: cOrange,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('${selectedVisible.length} selected',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
                    const SizedBox(height: 8),
                    AppSelect<String>(
                      label: 'Set status to…',
                      value: _bulkStatus,
                      options: optionsOf(cableStatusLabels),
                      onChanged: (o) => setState(() => _bulkStatus = o?.value),
                    ),
                    const SizedBox(height: 8),
                    btnWrap([
                      primaryBtn(
                          _busy
                              ? 'Applying…'
                              : 'Apply to ${selectedVisible.length} ${plural(selectedVisible.length, 'cable')}',
                          _busy || _bulkStatus == null ? null : () => _applyBulk(selectedVisible),
                          icon: Icons.check_rounded),
                      smallBtn('Clear selection', () => setState(_selected.clear)),
                    ]),
                  ],
                ),
              ),
            ),
          if (!_loaded)
            const LoadingView()
          else if (_cables.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted("No cables in this job's schedule yet.${widget.canEdit ? ' Use "+ Add Cable" to start it.' : ''}",
                  size: 13),
            )
          else if (visible.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 20), child: Muted('No cables match these filters.', size: 13))
          else
            for (final c in visible) _card(c, canRemove),
        ],
      ),
    );
  }

  Widget _card(Json c, bool canRemove) {
    final id = asInt(c['id'])!;
    final spec = _spec(c);
    final typeLine = [str(c['cable_type']), str(c['voltage_rating'])].where((s) => s.isNotEmpty).join(' · ');
    return ItemCard(
      selected: _selected.contains(id),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.canEdit)
              SizedBox(
                width: 32,
                height: 24,
                child: Checkbox(
                  value: _selected.contains(id),
                  onChanged: (_) => setState(() => _selected.contains(id) ? _selected.remove(id) : _selected.add(id)),
                ),
              ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(str(c['cable_tag']),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                  Text('${c['from_point']} → ${c['to_point']}', style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                ],
              ),
            ),
            pill(c['status'], cableStatusLabels, cableStatusHex),
          ],
        ),
        MetaWrap([
          ('Circuit', txt(c['circuit'])),
          ('Cable', spec.isEmpty && typeLine.isEmpty ? '—' : [spec, typeLine].where((s) => s.isNotEmpty).join(' · ')),
          ('Length (m)', c['length_m'] == null ? '—' : fmtNumber(c['length_m'])),
          ('Harness', txt(c['harness_ref'])),
          ('Colour', txt(c['color_code'])),
        ]),
        if (widget.canEdit) ...[
          const SizedBox(height: 8),
          btnWrap([
            smallBtn('Edit', _busy ? null : () => _openForm(c)),
            if (canRemove) smallBtn('Delete', _busy ? null : () => _delete(c), danger: true),
          ]),
        ],
      ],
    );
  }
}