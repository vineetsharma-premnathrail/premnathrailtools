// QC & Handover tab - phone copy of frontend/src/components/electrical/HandoverTab.tsx:
// closing stages, Inspection & QC (raised in Quality), Commissioning and the
// RRV Electrical Handover details.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _closingStages = ['inspection_qc', 'commissioning', 'final_documentation', 'handover', 'as_built_records'];

class HandoverTab extends StatefulWidget {
  const HandoverTab({super.key, required this.job, required this.canEdit, required this.onJob});
  final Json job;
  final bool canEdit;
  final ValueChanged<Json> onJob;

  @override
  State<HandoverTab> createState() => _HandoverTabState();
}

class _HandoverTabState extends State<HandoverTab> {
  bool _busy = false;
  late final _location = TextEditingController(text: str(widget.job['commissioning_location']));
  late DateTime? _commissionedOn = parseDate(widget.job['commissioned_on']);
  late final _toName = TextEditingController(text: str(widget.job['handover_to_name']));
  late final _toOrg = TextEditingController(text: str(widget.job['handover_to_organization']));
  late DateTime? _handoverDate = parseDate(widget.job['handover_date']);
  late final _remarks = TextEditingController(text: str(widget.job['handover_remarks']));

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;

  @override
  void dispose() {
    for (final c in [_location, _toName, _toOrg, _remarks]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(Map<String, dynamic> payload, String success) async {
    setState(() => _busy = true);
    try {
      final res = asJson(await Api.patch('/electrical/jobs/$jobId', data: payload));
      widget.onJob(res);
      if (mounted) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestQc() async {
    final ok = await confirmDialog(context,
        title: 'Request QC inspection?',
        message: 'A final inspection will be raised in Quality for ${job['job_number']} and the Quality team notified.',
        confirmLabel: 'Request Inspection');
    if (!ok) return;
    setState(() => _busy = true);
    try {
      final updated = asJson(await Api.post('/electrical/jobs/$jobId/request-inspection'));
      widget.onJob(updated);
      if (mounted) {
        showSnack(context,
            'Final inspection ${asJson(updated['summary'])['inspection_number']} raised in Quality. The Inspection & QC stage completes once Quality passes it.');
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = asJson(job['summary']);
    final inspectionNo = str(s['inspection_number']);
    final canQc = inspectionNo.isEmpty || s['inspection_status'] == 'failed';
    final detailsEditable = (widget.canEdit || job['status'] == 'on_hold') && Elec.can('jobs', 'edit') && Elec.jf('handover', 'edit');
    final canRequestQc = widget.canEdit && Elec.jf('handover', 'submit');
    final commTests = asInt(s['commissioning_tests']) ?? 0;
    final closing = rowsOf(job['stages']).where((st) => _closingStages.contains(st['stage_key'])).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DetailSection('Closing stages', children: [
          for (final st in closing)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Brand.background,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Brand.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(
                      child: Text(str(st['label']),
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
                    ),
                    pill(st['status'], stageStatusLabels, stageStatusHex),
                  ]),
                  if (st['gate_problems'] is List && (st['gate_problems'] as List).isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(str((st['gate_problems'] as List).first),
                          style: const TextStyle(fontSize: 12, color: Color(0xFF92400E))),
                    ),
                ],
              ),
            ),
        ]),
        DetailSection('Inspection & QC', children: [
          if (inspectionNo.isNotEmpty)
            Wrap(spacing: 10, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(inspectionNo, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
              pill(s['inspection_status'], inspectionLabels, inspectionHex),
              if (Perm.hasApp('quality') && str(job['quality_inspection_id_ref']).isNotEmpty)
                smallBtn(
                    'Open in Quality',
                    () => runAction(context,
                        () => Files.openInPortal('/dashboard/quality/final-inspection/${job['quality_inspection_id_ref']}'))),
            ])
          else
            const Muted("No inspection yet. Requesting one raises a final inspection in the Quality module for this RRV's "
                'electrical system and notifies the Quality team.', size: 13),
          if (canRequestQc && canQc) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: primaryBtn(
                  s['inspection_status'] == 'failed' ? 'Request Fresh QC Inspection' : 'Request QC Inspection',
                  _busy ? null : _requestQc,
                  icon: Icons.verified_outlined),
            ),
          ],
        ]),
        DetailSection('Commissioning', children: [
          Muted('$commTests commissioning ${plural(commTests, 'test')} recorded on the Tests tab. The stage also needs the '
              'commissioning date.'),
          const SizedBox(height: 8),
          if (!detailsEditable) ...[
            FieldRow('Commissioning Location', job['commissioning_location']),
            FieldRow('Commissioned On', job['commissioned_on'] == null ? null : fmtDate(job['commissioned_on'])),
          ] else ...[
            AppTextField(label: 'Commissioning Location', controller: _location, hint: 'e.g. Customer depot, Kanpur'),
            const SizedBox(height: 12),
            DateField(label: 'Commissioned On', value: _commissionedOn, onChanged: (d) => setState(() => _commissionedOn = d)),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: smallBtn(
                  'Save Commissioning',
                  _busy
                      ? null
                      : () => _save({
                            'commissioning_location': strOrNull(_location.text),
                            'commissioned_on': _commissionedOn == null ? null : apiDate(_commissionedOn!),
                          }, 'Commissioning details saved.')),
            ),
          ],
        ]),
        DetailSection('RRV Electrical Handover', children: [
          if (job['handed_over_at'] != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('Handed over ${fmtDateTime(job['handed_over_at'])}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cGreenDark)),
            ),
          if (!detailsEditable) ...[
            FieldRow('Handed Over To', job['handover_to_name']),
            FieldRow('Organisation', job['handover_to_organization']),
            FieldRow('Handover Date', job['handover_date'] == null ? null : fmtDate(job['handover_date'])),
            FieldRow('Handover Remarks', job['handover_remarks']),
          ] else ...[
            AppTextField(label: 'Handed Over To', controller: _toName, hint: 'Person receiving the RRV'),
            const SizedBox(height: 12),
            AppTextField(label: 'Organisation', controller: _toOrg),
            const SizedBox(height: 12),
            DateField(label: 'Handover Date', value: _handoverDate, onChanged: (d) => setState(() => _handoverDate = d)),
            const SizedBox(height: 12),
            AppTextField(
                label: 'Handover Remarks',
                controller: _remarks,
                maxLines: 3,
                hint: 'Punch points, spares handed over, training given…'),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: smallBtn(
                  'Save Handover Details',
                  _busy
                      ? null
                      : () => _save({
                            'handover_to_name': strOrNull(_toName.text),
                            'handover_to_organization': strOrNull(_toOrg.text),
                            'handover_date': _handoverDate == null ? null : apiDate(_handoverDate!),
                            'handover_remarks': strOrNull(_remarks.text),
                          }, 'Handover details saved. Complete the "RRV Electrical Handover" stage on the Stages tab once everything else is done.')),
            ),
          ],
        ]),
      ],
    );
  }
}