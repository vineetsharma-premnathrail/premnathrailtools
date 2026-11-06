// Panels tab - phone copy of frontend/src/components/electrical/PanelsTab.tsx
// (Panel Design and Panel Assembly stages). Moving a panel to Assembled or
// later stamps who assembled it and when, server-side.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _assembled = ['assembled', 'tested', 'installed'];

class PanelsTab extends StatefulWidget {
  const PanelsTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged});
  final Json job;
  final ElecMeta meta;
  final bool canEdit;
  final VoidCallback onChanged;

  @override
  State<PanelsTab> createState() => _PanelsTabState();
}

class _PanelsTabState extends State<PanelsTab> {
  List<Json> _panels = [];
  bool _loaded = false;
  String? _error;
  bool _busy = false;

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
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/panels'));
      if (mounted) {
        setState(() {
          _panels = rows;
          _error = null;
          _loaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not load the panels for $jobNo. ${ApiClient.describe(e)}';
          _loaded = true;
        });
      }
    }
  }

  Future<void> _mutate(Future<dynamic> Function() fn, String success) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openForm([Json? editing]) async {
    final types = widget.meta.panelTypes;
    final defaultType = types.containsKey('control') ? 'control' : (types.keys.isEmpty ? 'control' : types.keys.first);
    final tag = TextEditingController(text: str(editing?['panel_tag']));
    final name = TextEditingController(text: str(editing?['name']));
    var type = editing == null ? defaultType : str(editing['panel_type']);
    final location = TextEditingController(text: str(editing?['location_on_vehicle']));
    final enclosure = TextEditingController(text: str(editing?['enclosure_material']));
    final ip = TextEditingController(text: str(editing?['ip_rating']));
    final dims = TextEditingController(text: str(editing?['dimensions']));
    var status = editing == null ? 'designed' : str(editing['status']);
    final remarks = TextEditingController(text: str(editing?['remarks']));

    final ok = await showFormSheet(
      context,
      title: editing == null ? 'Add Panel' : 'Edit Panel ${editing['panel_tag']}',
      saveLabel: editing == null ? 'Add Panel' : 'Save Changes',
      builder: (ctx, setS) => [
        Muted(editing == null ? 'New panel on $jobNo.' : '${editing['name']} — $jobNo'),
        const FormHeading('Panel'),
        AppTextField(label: 'Panel Tag', controller: tag, required: true, hint: 'MCP-01'),
        AppTextField(label: 'Name', controller: name, required: true, hint: 'e.g. Main Control Panel'),
        AppSelect<String>(
          label: 'Panel Type',
          value: type,
          clearable: false,
          options: optionsOf(types),
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        const FormHeading('Construction'),
        AppTextField(label: 'Location on Vehicle', controller: location, hint: 'e.g. Driver cabin, LHS'),
        AppTextField(label: 'Enclosure Material', controller: enclosure, hint: 'e.g. CRCA, SS304'),
        AppTextField(label: 'IP Rating', controller: ip, hint: 'IP65'),
        AppTextField(label: 'Dimensions', controller: dims, hint: 'W × H × D mm'),
        const FormHeading('Status'),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: optionsOf(panelStatusLabels),
          onChanged: (o) => setS(() => status = o?.value ?? status),
        ),
        const Muted("Setting the status to Assembled, Tested or Installed records you as the assembler with today's date.",
            size: 12),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        final problems = <String>[
          if (tag.text.trim().isEmpty) 'Enter a panel tag (e.g. MCP-01).',
          if (name.text.trim().isEmpty) 'Enter a panel name.',
        ];
        if (problems.isNotEmpty) throw problems.join(' ');
        final payload = {
          'panel_tag': tag.text.trim(),
          'name': name.text.trim(),
          'panel_type': type,
          'location_on_vehicle': strOrNull(location.text),
          'enclosure_material': strOrNull(enclosure.text),
          'ip_rating': strOrNull(ip.text),
          'dimensions': strOrNull(dims.text),
          'status': status,
          'remarks': strOrNull(remarks.text),
        };
        if (editing == null) {
          await Api.post('/electrical/jobs/$jobId/panels', data: payload);
        } else {
          await Api.patch('/electrical/jobs/$jobId/panels/${editing['id']}', data: payload);
        }
      },
    );
    final t = tag.text.trim().toUpperCase();
    for (final ctrl in [tag, name, location, enclosure, ip, dims, remarks]) {
      ctrl.dispose();
    }
    if (ok) {
      await _load();
      widget.onChanged();
      if (mounted) showSnack(context, editing == null ? 'Panel $t added.' : 'Panel $t updated.');
    }
  }

  void _changeStatus(Json p, String status) {
    if (status == p['status']) return;
    final label = panelStatusLabels[status] ?? status;
    _mutate(() => Api.patch('/electrical/jobs/$jobId/panels/${p['id']}', data: {'status': status}),
        'Panel ${p['panel_tag']} is now $label.');
  }

  Future<void> _delete(Json p) async {
    final count = asInt(p['component_count']) ?? 0;
    final ok = await confirmDialog(context,
        title: 'Delete panel?',
        message: 'Delete panel ${p['panel_tag']} (${p['name']}) from $jobNo?'
            '${count > 0 ? ' $count BOM line(s) are mounted in it — move them to another panel on the BOM tab first.' : ''}',
        confirmLabel: 'Delete',
        danger: true);
    if (ok) await _mutate(() => Api.delete('/electrical/jobs/$jobId/panels/${p['id']}'), 'Panel ${p['panel_tag']} deleted.');
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = _isOpen && Elec.jf('panels', 'create');
    final canRemove = _isOpen && Elec.jf('panels', 'delete');
    final assembled = _panels.where((p) => _assembled.contains(p['status'])).length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Panels',
            summary: Muted('${_panels.length} ${plural(_panels.length, 'panel')} · $assembled assembled', size: 12),
            action: canAdd ? primaryBtn('Add Panel', _busy ? null : () => _openForm()) : null,
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (!_loaded)
            const LoadingView()
          else if (_panels.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted('No panels designed for this job yet.${widget.canEdit ? ' Use "+ Add Panel" to add the first one.' : ''}',
                  size: 13),
            )
          else
            for (final p in _panels) _card(p, canRemove),
        ],
      ),
    );
  }

  Widget _card(Json p, bool canRemove) {
    final encl = [str(p['enclosure_material']), str(p['ip_rating'])].where((s) => s.isNotEmpty).join(' · ');
    return ItemCard(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(str(p['panel_tag']),
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                  Text(str(p['name']), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading)),
                  if (str(p['dimensions']).isNotEmpty) Muted(str(p['dimensions']), size: 12),
                ],
              ),
            ),
            if (!widget.canEdit) pill(p['status'], panelStatusLabels, panelStatusHex),
          ],
        ),
        MetaWrap([
          ('Type', widget.meta.panelTypes[str(p['panel_type'])] ?? str(p['panel_type'])),
          ('Location', txt(p['location_on_vehicle'])),
          ('Enclosure / IP', encl.isEmpty ? '—' : encl),
          ('Components', fmtNumber(p['component_count'])),
          ('Assembled', p['assembled_at'] != null || str(p['assembled_by_name']).isNotEmpty
              ? '${txt(p['assembled_by_name'])} · ${fmtDate(p['assembled_at'])}'
              : '—'),
        ]),
        if (widget.canEdit) ...[
          const SizedBox(height: 10),
          AppSelect<String>(
            label: 'Status',
            value: str(p['status']),
            clearable: false,
            enabled: !_busy,
            options: optionsOf(panelStatusLabels),
            onChanged: (o) {
              if (o != null) _changeStatus(p, o.value);
            },
          ),
          const SizedBox(height: 8),
          btnWrap([
            smallBtn('Edit', _busy ? null : () => _openForm(p)),
            if (canRemove) smallBtn('Delete', _busy ? null : () => _delete(p), danger: true),
          ]),
        ],
      ],
    );
  }
}