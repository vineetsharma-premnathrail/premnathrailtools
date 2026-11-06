import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';
import 'mt_work_orders.dart';

// Requests - frontend/src/app/dashboard/maintenance/requests/** (list,
// "Report a Problem" form, request detail with triage, convert and the
// requester's repair confirmation).

/// Requests list (tab body, or a sub-page from a dashboard tile).
class RequestsList extends StatefulWidget {
  const RequestsList({super.key, this.initialStatus, this.initialBranch});
  final String? initialStatus;
  final int? initialBranch;

  @override
  State<RequestsList> createState() => _RequestsListState();
}

class _RequestsListState extends State<RequestsList> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = Vis('maintenance:requests');
  late String? _status = widget.initialStatus;
  late int? _branch = widget.initialBranch;
  bool _mine = false;
  Json? _lookups;

  bool get _isMt => Mt.isMaintenanceUser;

  @override
  void initState() {
    super.initState();
    if (_isMt) {
      MtLookups.tryGet().then((lk) {
        if (mounted) setState(() => _lookups = lk);
      });
    }
  }

  void _refilter(VoidCallback change) {
    setState(change);
    WidgetsBinding.instance.addPostFrameCallback((_) => _list.currentState?.reload());
  }

  Future<ApiPage> _load(int page, String search) => Api.list('/maintenance/requests', query: {
        'status': _status,
        'mine': _mine ? true : null,
        'branch_id': _branch,
        'search': search,
      });

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MtHeader(_isMt ? 'Maintenance Requests' : 'My Maintenance Requests'),
        filterRow([
          FilterSelect<String>(
            allLabel: 'All statuses',
            value: _status,
            options: optionsOf(requestStatusLabels),
            onChanged: (v) => _refilter(() => _status = v),
          ),
          if (branches.length > 1 || _branch != null)
            FilterSelect<int>(
              allLabel: 'All plants',
              value: _branch,
              options: branches,
              onChanged: (v) => _refilter(() => _branch = v),
            ),
          if (_isMt) FilterToggle(label: 'Raised by me', value: _mine, onChanged: (v) => _refilter(() => _mine = v)),
        ]),
      ],
    );
    return withFab(
      ApiListView(
        key: _list,
        load: _load,
        searchHint: 'Search by number, asset or problem…',
        header: header,
        emptyText: _status != null || _mine || _branch != null
            ? 'No requests match these filters.'
            : 'No maintenance requests yet. Use “Report Breakdown” when a machine stops or misbehaves.',
        itemBuilder: (ctx, r, reload) => _requestCard(ctx, r, reload),
      ),
      CreateFab(
        label: 'Report Breakdown',
        onPressed: () => reportBreakdown(context, onCreated: () => _list.currentState?.reload()),
      ),
    );
  }

  Widget _requestCard(BuildContext context, Json r, VoidCallback reload) {
    final wo = asMap(r['work_order']);
    final type = label(requestTypeLabels, r['request_type']).split(' (').first;
    return RecordCard(
      code: str(r['request_number']),
      title: _vis.column('requests', 'asset') ? '${str(r['asset_code'])} ${str(r['asset_name'])}'.trim() : str(r['request_number']),
      subtitle: _vis.column('requests', 'problem') ? str(r['problem_description']) : null,
      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        statusPill(requestStatusLabels, requestStatusHex, r['status']),
        if (r['can_confirm'] == true)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('Confirm repair', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: kAmber)),
          ),
      ]),
      meta: [
        if (_vis.column('requests', 'type')) ('Type', r['machine_down'] == true ? '$type · Machine down' : type),
        if (_vis.column('requests', 'priority')) ('Priority', priorityText(r['priority'])),
        if (_vis.column('requests', 'reported')) ('Reported', fmtDateTime(r['reported_at'])),
        if (_vis.column('requests', 'raised_by')) ('Raised By', txt(r['raised_by_name'])),
        if (_vis.column('requests', 'work_order'))
          ('Work Order', wo == null ? '—' : '${wo['wo_number']} · ${label(woStatusLabels, wo['status'])}'),
      ],
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RequestDetailScreen(id: asInt(r['id'])!)));
        reload();
      },
    );
  }
}

// ── Report a Problem (requests/new) ──────────────────────────────────────────

/// Opens the "Report a Problem" form; [asset] pre-selects the machine (asset
/// page / tag lookup). On success the new request opens.
Future<void> reportBreakdown(BuildContext context, {Json? asset, VoidCallback? onCreated}) async {
  final vis = Vis('maintenance:requests');
  final typeChoices = vis.options('request_type', requestTypeLabels.keys);
  final priorityChoices = vis.options('priority', priorityLabels.keys);
  final priorityRestricted = priorityChoices.length < priorityLabels.length;

  int? assetId = asInt(asset?['id']);
  Json? selected = asset;
  if (assetId != null && asset != null) assetCache[assetId] = asset;
  var requestType = typeChoices.contains('breakdown') ? 'breakdown' : typeChoices.first;
  var machineDown = requestType == 'breakdown';
  DateTime? reportedAt = DateTime.now();
  String priority = priorityRestricted ? priorityChoices.first : '';
  final problem = TextEditingController();
  final photos = <MultipartFile>[];
  Json? created;
  String? photoError;

  final saved = await showFormSheet(
    context,
    title: 'Report a Problem',
    saveLabel: 'Raise Request',
    builder: (ctx, setS) {
      final st = str(selected?['status']);
      return [
        hintText('Tell Maintenance what is wrong — they are notified at once and the request is tracked until the machine is confirmed working.'),
        if (vis.section('machine')) ...[
          sheetSection('Machine'),
          AppSelect<int>(
            label: 'Machine / Equipment',
            required: true,
            value: assetId,
            valueLabel: selected == null ? null : assetLabel(selected!),
            loadOptions: (q) => loadAssetOptions(q),
            onChanged: (o) => setS(() {
              assetId = o?.value;
              selected = o == null ? null : assetCache[o.value];
            }),
          ),
          if (selected != null && st != 'operational' && st != 'standby' && st.isNotEmpty)
            Text(
              'This asset is already marked ${label(assetStatusLabels, st).toLowerCase()} — check its open requests before raising another one.',
              style: const TextStyle(fontSize: 12, color: Color(0xFFB45309)),
            ),
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: machineDown ? kRed.withValues(alpha: 0.35) : Brand.border),
              color: machineDown ? kRed.withValues(alpha: 0.06) : null,
            ),
            child: CheckboxListTile(
              value: machineDown,
              controlAffinity: ListTileControlAffinity.leading,
              onChanged: (v) => setS(() => machineDown = v ?? false),
              title: Text('Machine is stopped',
                  style: TextStyle(fontWeight: FontWeight.w700, color: machineDown ? const Color(0xFFB91C1C) : Brand.heading)),
              subtitle: const Text(
                  "Starts the downtime clock from the time below and blocks the machine in Production until it's repaired.",
                  style: TextStyle(fontSize: 12)),
            ),
          ),
        ],
        if (vis.section('problem')) ...[
          sheetSection('Problem'),
          AppSelect<String>(
            label: 'Type',
            value: requestType,
            clearable: false,
            options: [for (final k in typeChoices) Option(k, requestTypeLabels[k]!)],
            onChanged: (o) => setS(() {
              if (o == null) return;
              requestType = o.value;
              // A breakdown means it stopped; the other types usually mean it's still running.
              machineDown = o.value == 'breakdown';
            }),
          ),
          DateTimeField(
            label: 'When did it happen?',
            value: reportedAt,
            notAfterNow: true,
            onChanged: (v) => setS(() => reportedAt = v),
          ),
          AppSelect<String>(
            label: 'Priority',
            value: priority,
            clearable: false,
            options: [
              if (!priorityRestricted) const Option('', 'Auto (from criticality)'),
              for (final k in priorityChoices) Option(k, priorityLabels[k]!),
            ],
            onChanged: (o) => setS(() => priority = o?.value ?? ''),
          ),
          AppTextField(
            label: "What's wrong?",
            required: true,
            controller: problem,
            maxLines: 5,
            hint: 'What happened, what you saw or heard, any alarm or error code on the panel…',
          ),
        ],
        if (vis.section('photos')) ...[
          sheetSection('Photos', extra: '(optional)'),
          Row(children: [
            Expanded(
              child: smallBtn('Take photo', () async {
                final f = await Files.takePhoto();
                if (f != null) setS(() => photos.add(f));
              }),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: smallBtn('Choose photos', () async {
                final f = await Files.pickPhoto();
                if (f != null) setS(() => photos.add(f));
              }),
            ),
          ]),
          for (var i = 0; i < photos.length; i++)
            Row(children: [
              Expanded(child: Text(photos[i].filename ?? 'Photo ${i + 1}', overflow: TextOverflow.ellipsis)),
              TextButton(
                onPressed: () => setS(() => photos.removeAt(i)),
                child: const Text('Remove', style: TextStyle(color: kRed)),
              ),
            ]),
          hintText(photos.isEmpty
              ? 'A photo of the fault, panel alarm or leak helps the technician come prepared.'
              : '${photos.length} photo${photos.length > 1 ? 's' : ''} will be attached.'),
        ],
      ];
    },
    onSave: () async {
      if (assetId == null) throw 'Pick the machine or equipment that has the problem.';
      if (problem.text.trim().isEmpty) throw 'Describe the problem — what happened, and any noise, leak, alarm or error code.';
      if (reportedAt != null && reportedAt!.isAfter(DateTime.now())) throw "Reported time can't be in the future.";
      created ??= asMap(await Api.post('/maintenance/requests', data: {
        'asset_id': assetId,
        'request_type': requestType,
        'machine_down': machineDown,
        'reported_at': isoOf(reportedAt),
        'problem_description': problem.text.trim(),
        'priority': priority.isEmpty ? null : priority,
      }));
      if (photos.isNotEmpty && created != null) {
        try {
          await uploadMtFiles('request', asInt(created!['id'])!, photos, 'photo');
        } catch (e) {
          // The request itself is saved - tell the requester the truth on the next screen.
          photoError = ApiClient.describe(e);
        }
      }
    },
  );
  problem.dispose();
  if (!saved || created == null || !context.mounted) return;
  onCreated?.call();
  final id = asInt(created!['id'])!;
  if (photoError != null) {
    showSnack(context,
        "${created!['request_number']} was raised, but the photos didn't upload: $photoError. Add them again under Photos & Files.",
        error: true);
  }
  openScreen(context, RequestDetailScreen(id: id));
}

// ── Request detail ───────────────────────────────────────────────────────────

const _defaultWoType = {'breakdown': 'breakdown', 'abnormality': 'corrective', 'improvement': 'improvement', 'safety': 'corrective'};

class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> {
  Json? _req;
  Object? _error;
  bool _busy = false;
  final _vis = Vis('maintenance:requests');

  bool get _isMt => Mt.isMaintenanceUser;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/maintenance/requests/${widget.id}');
      if (mounted) {
        setState(() {
          _req = asMap(d);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<dynamic> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    try {
      final d = await fn();
      if (!mounted) return;
      if (d is Map) setState(() => _req = Map<String, dynamic>.from(d));
      if (success != null) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject(String mode) async {
    final dup = mode == 'duplicate';
    final reason = await promptDialog(context,
        title: dup ? 'Mark as duplicate?' : 'Reject this request?',
        message: dup ? 'Say which request already covers this, e.g. "Same as MRQ-2026-0012".' : 'The requester will see this reason.',
        label: dup ? 'Duplicate of' : 'Reason',
        confirmLabel: dup ? 'Mark Duplicate' : 'Reject');
    if (reason == null) return;
    _run(() => Api.post('/maintenance/requests/${widget.id}/reject', data: {'status': mode, 'reason': reason}));
  }

  Future<void> _confirmOk() async {
    final ok = await confirmDialog(context,
        title: 'Confirm the machine is working?', message: 'Maintenance can then verify and close the work order.');
    if (ok) _run(() => Api.post('/maintenance/requests/${widget.id}/confirm', data: {'ok': true}));
  }

  Future<void> _notFixed() async {
    final comment = await promptDialog(context,
        title: 'Still a problem?',
        message: "The work order goes back to the technician. Say what's still wrong.",
        label: "What's still wrong",
        confirmLabel: 'Send Back');
    if (comment == null) return;
    _run(() => Api.post('/maintenance/requests/${widget.id}/confirm', data: {'ok': false, 'comment': comment}));
  }

  Future<void> _convert() async {
    final req = _req!;
    Json? lk;
    try {
      lk = await MtLookups.get();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    final allow = await assigneeFilter('maintenance:work_orders.assign');
    if (!mounted) return;
    final woVis = Vis('maintenance:work_orders');
    final typeChoices = woVis.options('wo_type', woTypeLabels.keys);
    final prChoices = woVis.options('priority', priorityLabels.keys);
    String firstAllowed(String wanted, List<String> choices) => choices.contains(wanted) ? wanted : choices.first;
    final title = TextEditingController(
        text: '${label(requestTypeLabels, req['request_type']).split(' (').first}: ${_cut(str(req['problem_description']), 80)}');
    final desc = TextEditingController(text: str(req['problem_description']));
    var woType = firstAllowed(_defaultWoType[req['request_type']] ?? 'corrective', typeChoices);
    var priority = firstAllowed(normPriority(req['priority']), prChoices);
    int? tech;
    DateTime? plannedStart;
    Json? updated;
    final techs = [
      for (final t in MtLookups.technicians(lk))
        if (allow(asInt(t['id']) ?? 0)) Option(asInt(t['id'])!, str(t['name'])),
    ];
    final saved = await showFormSheet(
      context,
      title: 'Create work order',
      saveLabel: 'Create Work Order',
      builder: (ctx, setS) => [
        hintText('From ${req['request_number']} — the request is marked Converted and linked to the job.'),
        sheetSection('Basic Information'),
        AppTextField(label: 'Title', required: true, controller: title),
        AppSelect<String>(
          label: 'Type',
          value: woType,
          clearable: false,
          options: [for (final k in typeChoices) Option(k, woTypeLabels[k]!)],
          onChanged: (o) => setS(() => woType = o?.value ?? woType),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: [for (final k in prChoices) Option(k, priorityLabels[k]!)],
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        AppTextField(label: 'Instructions', controller: desc, maxLines: 4),
        sheetSection('Assignment & Schedule', extra: '(optional)'),
        AppSelect<int>(
          label: 'Assign Technician',
          value: tech,
          options: techs,
          onChanged: (o) => setS(() => tech = o?.value),
        ),
        DateField(label: 'Planned Start', value: plannedStart, onChanged: (d) => setS(() => plannedStart = d)),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Give the work order a title.';
        updated = asMap(await Api.post('/maintenance/requests/${widget.id}/convert', data: {
          'title': title.text.trim(),
          'wo_type': woType,
          'priority': priority,
          'assigned_to_id': tech,
          'planned_start': plannedStart == null ? null : apiDate(plannedStart!),
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        }));
      },
    );
    title.dispose();
    desc.dispose();
    if (!saved || updated == null || !mounted) return;
    setState(() => _req = updated);
    final wo = asMap(updated!['work_order']);
    if (wo != null && asInt(wo['id']) != null) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderDetailScreen(id: asInt(wo['id'])!)));
      _load();
    }
  }

  List<BarAction> _actions(Json req) {
    final s = str(req['status']);
    final wo = asMap(req['work_order']);
    if (req['can_confirm'] == true && wo != null) {
      return [
        BarAction("Yes, it's working", _confirmOk, primary: true),
        BarAction('No, still a problem', _notFixed, danger: true),
      ];
    }
    final canTriage = _isMt && (s == 'open' || s == 'acknowledged');
    if (!canTriage) return [];
    final mayTriage = Mt.can('requests', 'edit');
    final mayAck = mayTriage && Mt.feat('requests', 'triage', 'approve');
    final mayReject = mayTriage && Mt.feat('requests', 'triage', 'reject');
    final mayConvert = Mt.can('work_orders', 'create');
    return [
      if (mayConvert) BarAction('Create Work Order', _convert, primary: true),
      if (mayAck && s == 'open')
        BarAction('Acknowledge', () => _run(() => Api.post('/maintenance/requests/${widget.id}/acknowledge'), success: 'Request acknowledged.')),
      if (mayReject) BarAction('Mark Duplicate', () => _reject('duplicate')),
      if (mayReject) BarAction('Reject', () => _reject('rejected'), danger: true),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final req = _req;
    final actions = req == null ? <BarAction>[] : _actions(req);
    return SubPage(
      title: str(req?['request_number']).isEmpty ? 'Request' : str(req!['request_number']),
      bottom: actions.isEmpty ? null : ActionBar(actions, busy: _busy),
      body: req == null
          ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(onRefresh: _load, child: _body(req)),
    );
  }

  Widget _body(Json req) {
    final wo = asMap(req['work_order']);
    final type = label(requestTypeLabels, req['request_type']).split(' (').first;
    final assetText = [str(req['asset_code']), str(req['asset_name'])].where((s) => s.isNotEmpty).join(' — ');
    final mine = req['raised_by_id'] != null && req['raised_by_id'] == Perm.userId;
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        MtHeader(str(req['request_number']), caps: 'Maintenance Request'),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Wrap(spacing: 8, runSpacing: 6, children: [
            statusPill(requestStatusLabels, requestStatusHex, req['status']),
            if (req['machine_down'] == true) const Pill('Machine down', kRed),
          ]),
        ),
        if (req['can_confirm'] == true && wo != null)
          NoteBanner(
            'Maintenance says this is fixed — is the machine OK?\n'
            '${str(wo['action_taken']).isNotEmpty ? 'Action taken: ${wo['action_taken']}' : '${wo['wo_number']} was marked completed.'}',
            color: kGreen,
          ),
        if (_vis.section('detail_summary'))
          DetailSection('$type — ${[str(req['asset_code']), str(req['asset_name'])].where((s) => s.isNotEmpty).join(' ')}', children: [
            Text(str(req['problem_description']), style: const TextStyle(fontSize: 14, color: Brand.body)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              priorityPill(req['priority'], suffix: ' priority'),
              smallText('· Happened ${fmtDateTime(req['reported_at'])}'),
              smallText('· Raised by ${txt(req['raised_by_name'])}', color: Brand.heading, weight: FontWeight.w600),
            ]),
          ]),
        if (_vis.section('detail_problem'))
          DetailSection('Problem', children: [
            FieldRow(
              'Asset',
              _isMt
                  ? InkWell(
                      onTap: () => openScreen(context, AssetDetailScreen(id: asInt(req['asset_id'])!)),
                      child: Text(assetText, style: const TextStyle(fontWeight: FontWeight.w600, color: kOrange)),
                    )
                  : Text(assetText, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
            ),
            FieldRow('Asset Criticality', req['asset_criticality'] == null ? null : label(criticalityLabels, req['asset_criticality'])),
            FieldRow('Plant', req['branch_name']),
            FieldRow('Type', label(requestTypeLabels, req['request_type'])),
            FieldRow('Acknowledged',
                req['acknowledged_at'] == null ? null : '${txt(req['acknowledged_by_name'])} · ${fmtDateTime(req['acknowledged_at'])}'),
            if (str(req['rejection_reason']).isNotEmpty)
              FieldRow(req['status'] == 'duplicate' ? 'Duplicate Of / Reason' : 'Rejection Reason', req['rejection_reason']),
          ]),
        if (wo != null && _vis.section('detail_work_order'))
          DetailSection('Work Order', children: [
            FieldRow(
              'Work Order',
              Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                InkWell(
                  onTap: _isMt ? () => openScreen(context, WorkOrderDetailScreen(id: asInt(wo['id'])!)) : null,
                  child: Text(str(wo['wo_number']),
                      style: TextStyle(fontWeight: FontWeight.w700, color: _isMt ? kOrange : Brand.heading)),
                ),
                statusPill(woStatusLabels, woStatusHex, wo['status']),
              ]),
            ),
            FieldRow('Technician', str(wo['assigned_to_name']).isEmpty ? 'Not assigned yet' : wo['assigned_to_name']),
            FieldRow('Downtime', wo['downtime_minutes'] == null ? null : formatMinutes(wo['downtime_minutes'])),
            if (str(wo['root_cause']).isNotEmpty) FieldRow('Root Cause', wo['root_cause']),
            if (str(wo['action_taken']).isNotEmpty) FieldRow('Action Taken', wo['action_taken']),
            FieldRow(mine ? 'Confirmed By You' : 'Requester Confirmed',
                wo['requester_confirmed_at'] == null ? null : fmtDateTime(wo['requester_confirmed_at'])),
          ]),
        if (_vis.section('detail_files'))
          AttachmentsSection(title: 'Photos & Files', entityType: 'request', entityId: widget.id, defaultDocType: 'photo'),
      ],
    );
  }
}

String _cut(String s, int n) => s.length <= n ? s : s.substring(0, n);
