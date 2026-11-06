import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import 'rnd_common.dart';

/// New / Edit Prototype / Research project (portal: projects/new + the
/// project's Edit page, ProjectOriginFields, RndBudgetFields).

const originLabels = {'existing_projects': 'Existing Projects', 'new_project': 'New Project'};
const originHex = {'existing_projects': '#D97706', 'new_project': '#7C3AED', 'not_recorded': '#78716c'};
const _originMeaning = {
  'existing_projects': 'Fix or improve a project / machine we already built — complaint, NCR, service issue, cost or production.',
  'new_project': 'A new product, process or technology — say who proposed it and why.',
};
const improvementReasons = [
  Option('customer_complaint', 'Customer complaint'),
  Option('ncr', 'NCR (non-conformance)'),
  Option('service_report', 'Service report / field issue'),
  Option('cost_reduction', 'Cost reduction'),
  Option('production_difficulty', 'Production difficulty'),
];
const kindLabels = {
  'inquiry': 'Inquiry',
  'tender': 'Tender',
  'quality_complaint': 'Customer complaint',
  'ncr': 'NCR',
  'service_request': 'Service request',
};

String normalizeOrigin(Object? v) {
  if (v == null || v == '') return '';
  return (v == 'existing_projects' || v == 'product_improvement') ? 'existing_projects' : 'new_project';
}

String _inr(Object? v) => v is num ? fmtMoney(v) : '—';

/// Shows the project form; returns the saved project (create) or true-ish
/// edited project. [project] = edit mode.
Future<Json?> showProjectForm(BuildContext context, {Json? project}) async {
  final editing = project != null;
  final m = _ProjectDraft.from(project);
  Json? saved;
  String? uploadProblem;
  final ok = await showFormSheet(
    context,
    title: editing ? 'Edit R&D Project' : 'New Prototype / Research Project',
    saveLabel: editing ? 'Save changes' : 'Create Project',
    builder: (ctx, setS) => [_ProjectFields(draft: m, creating: !editing, projectId: intOf(project?['id']))],
    onSave: () async {
      final originChanged = !editing || m.originPayload().toString() != _ProjectDraft.from(project).originPayload().toString();
      if (originChanged) {
        final msg = m.originError(editing ? null : m.files.length);
        if (msg != null) throw msg;
      }
      if (m.title.text.trim().isEmpty) throw 'Project title is required.';
      if (m.objective.text.trim().isEmpty) throw 'Objective is required — describe what this R&D project should achieve.';
      if (m.start != null && m.end != null && m.end!.isBefore(m.start!)) throw "Target end date can't be before the start date.";
      if (m.financeId == null && m.amount.text.trim().isNotEmpty && !((num.tryParse(m.amount.text.trim()) ?? -1) >= 0)) {
        throw 'Budget amount must be a number of rupees (0 or more), or leave it blank.';
      }
      final body = <String, dynamic>{
        if (originChanged) ...m.originPayload(),
        'title': m.title.text.trim(),
        'priority': m.priority,
        'objective': m.objective.text.trim(),
        'scope': m.scope.text.trim().isEmpty ? null : m.scope.text.trim(),
        'lead_ids': m.leads,
        'team_member_ids': m.team,
        'start_date': m.start == null ? null : apiDate(m.start!),
        'target_end_date': m.end == null ? null : apiDate(m.end!),
        'remarks': m.remarks.text.trim().isEmpty ? null : m.remarks.text.trim(),
        if (!editing || m.financeId != _ProjectDraft.from(project).financeId) 'internal_order_id': m.financeId,
        if (m.financeId == null) 'budget_amount': m.amount.text.trim().isEmpty ? null : num.tryParse(m.amount.text.trim()),
        if (!editing) 'attachment_count': m.files.length,
      };
      final p = jsonMap(
        editing ? await Api.patch('/rnd/projects/${project['id']}', data: body) : await Api.post('/rnd/projects', data: body),
      );
      final id = intOf(p['id']) ?? intOf(project?['id']);
      // Attachments go to the project's Documents; a failed file never undoes the save.
      final failed = <String>[];
      for (final f in m.files) {
        try {
          await postForm(
            '/rnd/documents',
            {'project_id': id, 'doc_type': 'other', 'title': f.filename ?? 'Attachment'},
            files: [f],
          );
        } catch (e) {
          failed.add('${f.filename}: ${ApiClient.describe(e)}');
        }
      }
      if (failed.isNotEmpty) {
        uploadProblem =
            '${editing ? 'Changes were saved' : 'Project ${p['project_number'] ?? ''} was created'}, but '
            '${failed.length} attachment(s) didn\'t upload — ${failed.join('; ')} — upload them again from the project\'s Documents tab.';
      }
      saved = p.isEmpty ? (project ?? {}) : p;
    },
  );
  if (ok && uploadProblem != null && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(uploadProblem!),
        backgroundColor: Brand.danger,
        duration: const Duration(seconds: 10),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
  return ok ? saved : null;
}

class _ProjectDraft {
  _ProjectDraft();

  factory _ProjectDraft.from(Json? p) {
    final d = _ProjectDraft();
    if (p == null) {
      d.start = DateTime.now();
      if (Perm.userId != null) d.leads = [Perm.userId!];
      return d;
    }
    d.origin = normalizeOrigin(p['origin']);
    d.sourceKind = str(p, 'source_kind');
    d.sourceId = intOf(p['source_id']);
    d.reason = str(p, 'improvement_reason');
    d.productId = intOf(p['product_id']);
    d.machineId = intOf(p['machine_id']);
    d.machineLabel = str(p, 'machine_label');
    d.note.text = str(p, 'origin_note') ?? '';
    d.title.text = str(p, 'title') ?? '';
    d.objective.text = str(p, 'objective') ?? '';
    d.scope.text = str(p, 'scope') ?? '';
    d.priority = normalizePriority(p['priority']);
    d.start = parseDate(p['start_date']);
    d.end = parseDate(p['target_end_date']);
    d.remarks.text = str(p, 'remarks') ?? '';
    final leads = (p['lead_ids'] is List) ? (p['lead_ids'] as List).map(intOf).whereType<int>().toList() : <int>[];
    d.leads = leads.isNotEmpty ? leads : [if (intOf(p['lead_id']) != null) intOf(p['lead_id'])!];
    d.team = (p['team_member_ids'] is List) ? (p['team_member_ids'] as List).map(intOf).whereType<int>().toList() : <int>[];
    if (boolOf(p['budget_from_finance']) && p['internal_order_id'] != null) {
      d.financeId = intOf(p['internal_order_id']);
      d.financeLabel = [str(p, 'internal_order_code'), str(p, 'internal_order_name')].whereType<String>().join(' — ');
    } else if (p['budget_amount'] != null) {
      d.amount.text = '${p['budget_amount']}';
    }
    return d;
  }

  String origin = '';
  String? sourceKind;
  int? sourceId;
  String? reason;
  int? productId;
  int? machineId;
  String? machineLabel;
  final note = TextEditingController();
  final title = TextEditingController();
  final objective = TextEditingController();
  final scope = TextEditingController();
  String priority = 'standard';
  DateTime? start;
  DateTime? end;
  final remarks = TextEditingController();
  List<int> leads = [];
  List<int> team = [];
  int? financeId;
  String? financeLabel;
  final amount = TextEditingController();
  List<MultipartFile> files = [];

  Map<String, dynamic> originPayload() {
    final kind = origin == 'new_project' ? (sourceKind ?? '') : '';
    final linked = kind.isNotEmpty && sourceId != null;
    return {
      'origin': origin.isEmpty ? null : origin,
      'source_kind': linked ? kind : null,
      'source_id': linked ? sourceId : null,
      'improvement_reason': origin == 'existing_projects' ? reason : null,
      'product_id': origin == 'new_project' ? productId : null,
      'machine_id': origin == 'existing_projects' ? machineId : null,
      'origin_note': note.text.trim().isEmpty ? null : note.text.trim(),
    };
  }

  /// `attachments` = files staged (null when editing - proof is only checked on create).
  String? originError(int? attachments) {
    if (origin.isEmpty) return 'Pick the project origin — why this project exists (Existing Projects or New Project).';
    if (origin == 'existing_projects') {
      if (machineId == null) return 'Pick the existing project being improved (PEW number) — Project Origin › Existing Projects.';
      if (reason == null) return 'Pick the reason for the improvement (Project Origin › Existing Projects).';
    }
    if (origin == 'new_project' && note.text.trim().isEmpty) {
      return "Fill 'Who proposed it and why' in Project Origin — it is required for a New Project.";
    }
    if (attachments != null && origin == 'new_project' && attachments < 1) {
      return 'Attach at least one proof document in Attachments — the proposal, management note or study behind this New Project.';
    }
    return null;
  }
}

class _ProjectFields extends StatefulWidget {
  const _ProjectFields({required this.draft, required this.creating, this.projectId});
  final _ProjectDraft draft;
  final bool creating;
  final int? projectId;

  @override
  State<_ProjectFields> createState() => _ProjectFieldsState();
}

class _ProjectFieldsState extends State<_ProjectFields> {
  List<Json> _users = [];
  List<Json>? _budgets;
  String? _loadError;

  _ProjectDraft get d => widget.draft;

  @override
  void initState() {
    super.initState();
    Api.get('/users/directory').then(
      (u) {
        if (mounted) setState(() => _users = jsonList(u));
      },
      onError: (e) {
        if (mounted) {
          setState(() => _loadError = 'Failed to load the user list for Project Lead / Team: ${ApiClient.describe(e)}');
        }
      },
    );
    Api.get('/rnd/projects/budget-options', query: {'project_id': widget.projectId}).then(
      (b) {
        if (mounted) setState(() => _budgets = jsonList(b));
      },
      onError: (e) {
        if (mounted) setState(() => _budgets = []);
      },
    );
  }

  String _budgetLabel(Json o) =>
      '${o['code']} — ${o['name']}${o['budgeted_amount'] != null ? ' · ${_inr(o['budgeted_amount'])}' : ''}'
      '${o['available_amount'] != null ? ' (${_inr(o['available_amount'])} free)' : ''}';

  Widget _gap() => const SizedBox(height: 14);

  @override
  Widget build(BuildContext context) {
    final proof = d.origin == 'new_project';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_loadError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Hint(_loadError!, color: Brand.danger),
          ),
        const FormHeading('Project Origin *'),
        const Hint('Why does this project exist?'),
        const SizedBox(height: 6),
        for (final o in originLabels.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Material(
              color: d.origin == o.key ? const Color(0x0F2563EB) : Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: d.origin == o.key ? const Color(0xFF2563EB) : Brand.border, width: 1.5),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => setState(() {
                  if (d.origin == o.key) return;
                  d.origin = o.key;
                  d.sourceKind = null;
                  d.sourceId = null;
                  d.reason = null;
                  d.productId = null;
                  d.machineId = null;
                  d.machineLabel = null;
                }),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        o.key == 'existing_projects' ? Icons.build_outlined : Icons.lightbulb_outline,
                        color: d.origin == o.key ? const Color(0xFF2563EB) : Brand.muted,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              o.value,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: d.origin == o.key ? const Color(0xFF2563EB) : Brand.heading,
                              ),
                            ),
                            Text(_originMeaning[o.key]!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        if (d.origin == 'existing_projects') ...[
          AppSelect<int>(
            label: 'Existing project being improved',
            required: true,
            value: d.machineId,
            valueLabel: d.machineLabel,
            loadOptions: (q) async => [
              for (final o in jsonList(await Api.get('/rnd/projects/source-options', query: {'kind': 'machine', 'q': q})))
                Option(intOf(o['id']) ?? 0, str(o, 'label') ?? '', subtitle: str(o, 'sub')),
            ],
            onChanged: (o) => setState(() {
              d.machineId = o?.value;
              d.machineLabel = o?.label;
            }),
          ),
          _gap(),
          AppSelect<String>(
            label: 'Reason',
            required: true,
            value: d.reason,
            options: improvementReasons,
            onChanged: (o) => setState(() => d.reason = o?.value),
          ),
          _gap(),
        ],
        if (d.origin.isNotEmpty) ...[
          AppTextField(
            label: 'Who proposed it and why',
            controller: d.note,
            required: proof,
            maxLines: 3,
            hint: d.origin == 'existing_projects'
                ? 'e.g. Production (Mr. X) — the casting needs 3 re-machining steps; a fabricated part would halve the cost.'
                : 'e.g. Proposed by the R&D head after the Jan review — the market needs a lighter model.',
          ),
          const SizedBox(height: 6),
          Hint(
            d.origin == 'existing_projects'
                ? 'The project being improved and the reason are enough; add who proposed it if useful.'
                : 'Proof: attach the proposal or management note in Attachments.'
                      '${widget.creating ? ' At least one attachment is required.' : ''}',
          ),
          _gap(),
        ],
        const FormHeading('Project Initiation'),
        const SizedBox(height: 8),
        AppTextField(
          label: 'Project Title',
          controller: d.title,
          required: true,
          hint: 'e.g. Lightweight bogie frame for track machines',
        ),
        _gap(),
        AppTextField(
          label: 'Objective',
          controller: d.objective,
          required: true,
          maxLines: 4,
          hint: 'What should this project achieve, and why?',
        ),
        _gap(),
        AppTextField(label: 'Scope', controller: d.scope, maxLines: 3, hint: 'In scope / out of scope, key deliverables'),
        _gap(),
        const FormHeading('Priority & Schedule'),
        const SizedBox(height: 8),
        AppSelect<String>(
          label: 'Priority',
          value: d.priority,
          clearable: false,
          options: priorityOptions,
          onChanged: (o) => setState(() => d.priority = o?.value ?? 'standard'),
        ),
        _gap(),
        DateField(label: 'Start Date', value: d.start, onChanged: (v) => setState(() => d.start = v)),
        _gap(),
        DateField(label: 'Target End Date', value: d.end, onChanged: (v) => setState(() => d.end = v)),
        _gap(),
        const FormHeading('Budget (optional)'),
        const SizedBox(height: 8),
        AppSelect<int>(
          label: 'Finance budget',
          value: d.financeId,
          valueLabel: d.financeLabel,
          options: [for (final b in _budgets ?? const <Json>[]) Option(intOf(b['id']) ?? 0, _budgetLabel(b))],
          enabled: _budgets != null,
          onChanged: (o) => setState(() {
            d.financeId = o?.value;
            d.financeLabel = o?.label;
          }),
        ),
        if (_budgets != null && _budgets!.isEmpty)
          const Hint(
            'No open budget is free. Finance creates budgets in Finance › Masters › Internal orders (one budget per project).',
          ),
        if (d.financeId == null) ...[
          _gap(),
          AppTextField(label: 'Budget amount (₹)', controller: d.amount, keyboardType: AppTextField.number, hint: 'e.g. 250000'),
        ],
        const SizedBox(height: 6),
        Hint(
          d.financeId != null
              ? 'The amount is set by Finance on that budget. Purchases charged to this project are booked on it.'
              : 'Pick a budget Finance created, or type an amount — Finance then opens a development budget with the first purchase charged to this project.',
        ),
        _gap(),
        const FormHeading('Project Members'),
        const SizedBox(height: 8),
        PeoplePicker(
          label: 'Project Leads',
          users: _users,
          value: d.leads,
          exclude: d.team,
          onChanged: (v) => setState(() => d.leads = v),
        ),
        _gap(),
        PeoplePicker(
          label: 'Team Members',
          users: _users,
          value: d.team,
          exclude: d.leads,
          onChanged: (v) => setState(() => d.team = v),
        ),
        _gap(),
        AppTextField(label: 'Remarks', controller: d.remarks, maxLines: 3),
        _gap(),
        FilesField(
          label: proof && widget.creating ? 'Attachments — proof required' : 'Attachments (optional)',
          required: proof && widget.creating,
          files: d.files,
          onChanged: (f) => setState(() => d.files = f),
          hint: proof
              ? 'Attach the proof of origin (proposal, management note, cost study or production report) — plus any specs, drawings or photos.'
              : "Specs, drawings, photos, reference papers — saved to the project's Documents.",
        ),
      ],
    );
  }
}
