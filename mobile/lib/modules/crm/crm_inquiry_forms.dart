import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_record_tabs.dart';

/// Picks Inquiry or Tender, then opens its form (inquiries/new page toggle). Returns (kind, saved record).
Future<(CrmKind, Json)?> newInquiryOrTender(BuildContext context, {int? orgId, String? orgName}) async {
  final kind = await showModalBottomSheet<CrmKind>(
    context: context,
    backgroundColor: Colors.white,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Padding(padding: EdgeInsets.all(16), child: Caps('New inquiry or tender')),
        ListTile(
          leading: const Icon(Icons.description_outlined),
          title: const Text('Inquiry'),
          subtitle: const Text('A customer requirement: who asked, for what, and by when.'),
          onTap: () => Navigator.pop(ctx, CrmKind.inquiry),
        ),
        ListTile(
          leading: const Icon(Icons.flag_outlined),
          title: const Text('Tender'),
          subtitle: const Text('A published tender we may bid for: who floated it, its number and its key dates.'),
          onTap: () => Navigator.pop(ctx, CrmKind.tender),
        ),
      ]),
    ),
  );
  if (kind == null || !context.mounted) return null;
  final saved = kind == CrmKind.inquiry
      ? await showInquiryForm(context, defaultOrgId: orgId, defaultOrgName: orgName)
      : await showTenderForm(context, defaultOrgId: orgId, defaultOrgName: orgName);
  return saved == null ? null : (kind, saved);
}

/// Client company + contact person picker block shared by both forms.
class _ClientPicker {
  _ClientPicker({this.orgId, this.orgName, this.contactId});
  int? orgId;
  String? orgName;
  int? contactId;
  List<Json> contacts = const [];
  Json? org;
  String? duplicateWarning;

  Json? get contact => contacts.where((c) => asInt(c['id']) == contactId).firstOrNull;

  Future<void> loadOrg(StateSetter setS, {required bool checkOpen}) async {
    final id = orgId;
    if (id == null) {
      setS(() {
        contacts = const [];
        duplicateWarning = null;
      });
      return;
    }
    try {
      final cs = await loadContacts(id);
      final o = await Api.get('/crm/organizations/$id');
      setS(() {
        contacts = cs;
        org = o is Map ? Map<String, dynamic>.from(o) : null;
        orgName ??= str(org?['name']);
      });
    } catch (_) {}
    if (!checkOpen) return;
    try {
      final inqs = (await Api.list('/crm/inquiries', query: {'org_id': id})).rows.where((i) => !str(i['status']).startsWith('Closed')).toList();
      final tnds = (await Api.list('/crm/tenders', query: {'org_id': id}))
          .rows
          .where((t) => !str(t['status']).startsWith('Closed') && t['status'] != 'Tender Cancelled')
          .toList();
      final parts = <String>[
        if (inqs.isNotEmpty) '${inqs.length} open inquiry (${inqs.map((i) => i['universal_id']).join(', ')})',
        if (tnds.isNotEmpty) '${tnds.length} open tender (${tnds.map((t) => t['universal_id']).join(', ')})',
      ];
      setS(() => duplicateWarning = parts.isEmpty
          ? null
          : "This customer organization already has ${parts.join(' and ')}. Make sure you're not creating a duplicate.");
    } catch (_) {}
  }

  List<Widget> fields(BuildContext context, StateSetter setS,
      {required String orgLabel, required bool contactRequired, required bool locked, required bool checkOpen, VoidCallback? onOrgChanged}) {
    final c = contact;
    return [
      AppSelect<int>(
        label: orgLabel,
        required: true,
        enabled: !locked,
        value: orgId,
        valueLabel: orgName,
        loadOptions: loadOrgOptions,
        clearable: false,
        onChanged: (o) {
          if (o == null) return;
          setS(() {
            orgId = o.value;
            orgName = o.label;
            contactId = null;
          });
          loadOrg(setS, checkOpen: checkOpen).then((_) => onOrgChanged?.call());
        },
      ),
      Row(children: [
        Expanded(
          child: AppSelect<int>(
            label: contactRequired ? 'Contact Person' : 'Contact Person (optional)',
            required: contactRequired,
            enabled: orgId != null,
            value: contactId,
            valueLabel: c == null ? null : str(c['name']),
            options: [for (final x in contacts) Option(asInt(x['id'])!, str(x['name']), subtitle: str(x['designation']))],
            onChanged: (o) => setS(() => contactId = o?.value),
          ),
        ),
        rowIconButton(Icons.person_add_alt_1_outlined, 'Add New Contact', orgId == null
            ? null
            : () async {
                final created = await showQuickContactForm(context, orgId!, existing: contacts, multiValues: true);
                if (created != null) {
                  setS(() {
                    if (!contacts.any((x) => x['id'] == created['id'])) contacts = [...contacts, created];
                    contactId = asInt(created['id']);
                  });
                }
              }),
      ]),
      if (c != null)
        InfoBox(
          joinNonEmpty([
            'Name: ${str(c['name'])}',
            'Designation: ${txt(c['designation'])}',
            'Mobile: ${joinNonEmpty([c['mobile'], ...strList(c['additional_mobiles'])]).isEmpty ? '—' : joinNonEmpty([c['mobile'], ...strList(c['additional_mobiles'])])}',
            'Email: ${joinNonEmpty([c['email'], ...strList(c['additional_emails'])]).isEmpty ? '—' : joinNonEmpty([c['email'], ...strList(c['additional_emails'])])}',
          ], '\n'),
          color: const Color(0xFF334155),
          bg: const Color(0xFFF8FAFC),
        ),
      if (duplicateWarning != null) InfoBox.warn(duplicateWarning!),
    ];
  }
}

class _ExtraProduct {
  _ExtraProduct({String product = '', String spec = '', this.category = '', this.quantity})
      : product = TextEditingController(text: product),
        spec = TextEditingController(text: spec);
  final TextEditingController product;
  final TextEditingController spec;
  final String category;
  final num? quantity;
}

/// New / edit inquiry (components/crm/InquiryForm.tsx). Returns the saved inquiry.
Future<Json?> showInquiryForm(BuildContext context, {Json? initial, int? defaultOrgId, String? defaultOrgName}) async {
  final isEdit = initial != null;
  final client = _ClientPicker(
      orgId: asInt(initial?['org_id']) ?? defaultOrgId,
      orgName: defaultOrgName,
      contactId: asInt(initial?['org_contact_id']));
  DateTime? inquiryDate = dateOf(initial?['inquiry_date']) ?? dateOf(initial?['created_at']) ?? DateTime.now();
  String? leadSource = str(initial?['lead_source']).isEmpty ? null : str(initial!['lead_source']);
  var priority = CrmLists.normalizePriority(initial?['priority']);
  var status = str(initial?['status']).isEmpty ? 'Lead' : str(initial!['status']);
  final statusNote = TextEditingController(text: str(initial?['current_status_note']));
  final product = TextEditingController(text: str(initial?['product']));
  final productSpec = TextEditingController(text: str(initial?['product_spec']));
  final projectDetails = TextEditingController(text: str(initial?['project_details']));
  var railwayZone = str(initial?['railway_zone']);
  var division = str(initial?['division']);
  final extras = [
    for (final it in jsonList(initial?['additional_items']))
      _ExtraProduct(product: str(it['product']), spec: str(it['product_spec']), category: str(it['product_category']), quantity: asNum(it['quantity'])),
  ];
  String previewNumber = '';
  Json? lost;
  Json? saved;

  if (client.orgId != null) {
    await client.loadOrg((fn) => fn(), checkOpen: !isEdit);
    if (!isEdit && client.org != null) {
      railwayZone = str(client.org!['railway_zone']);
      division = str(client.org!['division_workshop']);
    }
  }
  if (!isEdit) {
    try {
      final all = (await Api.list('/crm/inquiries')).rows;
      final t = DateTime.now();
      previewNumber =
          'INQ-${t.year}${t.month.toString().padLeft(2, '0')}${t.day.toString().padLeft(2, '0')}-${(all.length + 1).toString().padLeft(4, '0')}';
    } catch (_) {}
  }
  if (!context.mounted) return null;

  final ok = await showFormSheet(
    context,
    title: isEdit ? 'Edit Inquiry ${str(initial['universal_id'])}'.trim() : 'New Inquiry',
    saveLabel: isEdit ? 'Save Changes' : 'Create Inquiry',
    builder: (ctx, setS) {
      final chosen = client.orgId != null && client.contactId != null;
      final canAdd = product.text.trim().isNotEmpty && extras.every((e) => e.product.text.trim().isNotEmpty);
      return [
        Note(isEdit ? 'Change the inquiry — the change is recorded in its timeline.' : 'A customer requirement: who asked, for what, and by when.'),
        const FormSection('Company Information'),
        ...client.fields(ctx, setS,
            orgLabel: 'Client Company',
            contactRequired: true,
            locked: defaultOrgId != null,
            checkOpen: !isEdit,
            onOrgChanged: () {
              if (!isEdit && client.org != null) {
                setS(() {
                  railwayZone = str(client.org!['railway_zone']);
                  division = str(client.org!['division_workshop']);
                });
              }
            }),
        if (!chosen)
          const InfoBox('Pick the Client Company and Contact Person first — the rest of the inquiry opens once the client is chosen.'),
        if (chosen) ...[
          const FormSection('Basic Information'),
          InputDecorator(
            decoration: fieldDecoration('Inquiry Number'),
            child: Text(isEdit ? str(initial['universal_id']) : (previewNumber.isEmpty ? 'Auto-generated on save' : previewNumber),
                style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF2563EB))),
          ),
          DateField(label: 'Inquiry Date', required: true, value: inquiryDate, lastDate: DateTime.now(), onChanged: (d) => setS(() => inquiryDate = d)),
          AppSelect<String>(
              label: 'Lead Source',
              required: true,
              value: leadSource,
              options: opts(keepCurrent(CrmLists.leadSources, leadSource)),
              onChanged: (o) => setS(() => leadSource = o?.value)),
          AppSelect<String>(
              label: 'Customer Requirement Priority',
              required: true,
              value: priority,
              clearable: false,
              options: opts(CrmLists.priorities, label: CrmLists.priorityLabel),
              onChanged: (o) => setS(() => priority = o?.value ?? priority)),
          AppSelect<String>(
              label: 'Status',
              required: true,
              value: status,
              clearable: false,
              options: opts(keepCurrent(CrmLists.inquiryStatuses, initial?['status'])),
              onChanged: (o) => setS(() => status = o?.value ?? status)),
          AppTextField(label: 'Current Status', controller: statusNote, maxLines: 2, hint: 'e.g. Waiting for client confirmation'),
          const FormSection('Product Requirement'),
          Row(children: [
            Expanded(
                child: AppTextField(
                    label: 'Product',
                    required: true,
                    controller: product,
                    hint: 'e.g. RRV for OHE maintenance, 1676 mm BG',
                    onChanged: (_) => setS(() {}))),
            rowIconButton(Icons.add_rounded, canAdd ? 'Add another product' : 'Fill in the product first.',
                canAdd ? () => setS(() => extras.add(_ExtraProduct())) : null),
          ]),
          AppTextField(
              label: 'Customer Requirement',
              controller: productSpec,
              maxLines: 3,
              hint: 'e.g. High Speed Self Propelled, 1676mm BG, hydraulic braking, anti-climber arrangement...'),
          for (var i = 0; i < extras.length; i++) ...[
            Row(key: ObjectKey(extras[i]), children: [
              Expanded(
                  child: AppTextField(
                      label: 'Product ${i + 2}',
                      controller: extras[i].product,
                      hint: 'e.g. Rail welding plant transporter',
                      onChanged: (_) => setS(() {}))),
              rowIconButton(Icons.close_rounded, 'Remove this product', () => setS(() => extras.removeAt(i)), color: const Color(0xFFDC2626)),
            ]),
            AppTextField(label: 'Customer Requirement', controller: extras[i].spec, maxLines: 2, hint: 'What the customer needs for this product'),
          ],
          const FormSection('Project Details'),
          AppTextField(label: 'Project Details', controller: projectDetails, maxLines: 3, hint: 'Project background, scope, timeline...'),
        ],
      ];
    },
    onSave: () async {
      if (client.orgId == null) throw 'Please select a customer organization.';
      if (inquiryDate == null) throw 'Please pick the Inquiry Date — the day the customer raised this requirement.';
      if (isoDate(inquiryDate).compareTo(todayIso()) > 0) {
        throw 'Inquiry Date cannot be in the future. Pick the day the customer actually raised it (today or earlier).';
      }
      if (leadSource == null) throw 'Please select a lead source.';
      if (product.text.trim().isEmpty) throw 'Please enter the product.';
      if (client.contactId == null) throw 'Please select a contact person, or save the new contact you are adding.';
      final filled = extras.where((e) => e.product.text.trim().isNotEmpty || e.spec.text.trim().isNotEmpty).toList();
      if (filled.any((e) => e.product.text.trim().isEmpty)) {
        throw 'Please enter a Product for every additional product row, or remove the empty row.';
      }
      final keys = [product.text.trim().toLowerCase(), ...filled.map((e) => e.product.text.trim().toLowerCase())];
      if (keys.toSet().length != keys.length) {
        throw 'The same Category/Product combination is added more than once. Remove the duplicate before saving.';
      }
      if (status == CrmLists.lostStatus && str(initial?['lost_reason_code']).isEmpty && lost == null) {
        lost = await askLostReason(context);
        if (lost == null) throw 'Closing as "Closed - Not Ordered" needs the lost reason — save again and pick it, or choose another status.';
      }
      final payload = <String, dynamic>{
        'org_id': client.orgId,
        'org_contact_id': client.contactId,
        'inquiry_date': apiDate(inquiryDate!),
        'railway_zone': railwayZone,
        'division': division,
        'lead_source': leadSource,
        'priority': priority,
        'status': status,
        'current_status_note': statusNote.text.trim(),
        'product': product.text.trim(),
        'product_category': str(initial?['product_category']),
        'product_spec': productSpec.text.trim(),
        'project_details': projectDetails.text.trim(),
        if (initial?['quantity'] != null) 'quantity': initial!['quantity'],
        'additional_items': [
          for (final e in filled)
            {
              'product': e.product.text.trim(),
              if (e.category.isNotEmpty) 'product_category': e.category,
              if (e.spec.text.trim().isNotEmpty) 'product_spec': e.spec.text.trim(),
              'quantity': ?e.quantity,
            },
        ],
        ...?lost,
      };
      payload.removeWhere((k, v) => v == null || v == '');
      final r = await guard(() => isEdit ? Api.patch('/crm/inquiries/${initial['id']}', data: payload) : Api.post('/crm/inquiries', data: payload));
      saved = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? saved : null;
}

/// New / edit tender (components/crm/TenderForm.tsx). Returns the saved tender.
Future<Json?> showTenderForm(BuildContext context, {Json? initial, int? defaultOrgId, String? defaultOrgName}) async {
  final isEdit = initial != null;
  final seePrices = CrmPerm.it('prices', 'view');
  final client = _ClientPicker(
      orgId: asInt(initial?['org_id']) ?? defaultOrgId, orgName: defaultOrgName, contactId: asInt(initial?['org_contact_id']));
  final number = TextEditingController(text: str(initial?['tender_number']));
  final name = TextEditingController(text: str(initial?['tender_name']));
  final authority = TextEditingController(text: str(initial?['tender_authority']));
  final (portal0, portalOther0) = splitOther(initial?['tender_portal'], CrmLists.tenderPortals);
  var portal = portal0;
  final portalOther = TextEditingController(text: portalOther0);
  String? type = str(initial?['tender_type']).isEmpty ? null : str(initial!['tender_type']);
  final value = TextEditingController(text: initial?['tender_value'] == null ? '' : fmtQty(initial!['tender_value']));
  var currency = str(initial?['currency']).isEmpty ? 'INR' : str(initial!['currency']);
  var status = str(initial?['status']).isEmpty ? 'Waiting for Future Tender' : str(initial!['status']);
  final details = TextEditingController(text: str(initial?['tender_details']));
  final statusNote = TextEditingController(text: str(initial?['current_status_note']));
  DateTime? tenderDate = dateOf(initial?['tender_date']) ?? dateOf(initial?['created_at']) ?? DateTime.now();
  var priority = CrmLists.normalizePriority(initial?['priority']);
  DateTime? publish = dateOf(initial?['publish_date']);
  DateTime? docDownload = dateOf(initial?['doc_download_date']);
  DateTime? submission = dateOf(initial?['submission_date']);
  DateTime? closingDate = dateOf(str(initial?['closing_at']).length >= 10 ? str(initial!['closing_at']).substring(0, 10) : null);
  var closingTime = str(initial?['closing_at']).length >= 16 ? str(initial!['closing_at']).substring(11, 16) : '00:00';
  var railwayZone = str(initial?['railway_zone']);
  var division = str(initial?['division']);
  String previewNumber = '';
  Json? saved;

  if (client.orgId != null) {
    await client.loadOrg((fn) => fn(), checkOpen: false);
    if (!isEdit && client.org != null) {
      railwayZone = str(client.org!['railway_zone']);
      division = str(client.org!['division_workshop']);
    }
  }
  if (!isEdit) {
    try {
      final all = (await Api.list('/crm/tenders')).rows;
      final t = DateTime.now();
      previewNumber =
          'TND-${t.year}${t.month.toString().padLeft(2, '0')}${t.day.toString().padLeft(2, '0')}-${(all.length + 1).toString().padLeft(4, '0')}';
    } catch (_) {}
  }
  if (!context.mounted) return null;

  String timeLabel(String hhmm) {
    final p = hhmm.split(':');
    final h = int.tryParse(p[0]) ?? 0;
    final m = p.length > 1 ? p[1] : '00';
    return '${h % 12 == 0 ? 12 : h % 12}:$m ${h < 12 ? 'AM' : 'PM'}';
  }

  final ok = await showFormSheet(
    context,
    title: isEdit ? 'Edit Tender ${str(initial['universal_id'])}'.trim() : 'New Tender',
    saveLabel: isEdit ? 'Save Changes' : 'Create Tender',
    builder: (ctx, setS) {
      final need = !CrmLists.tenderNoDetailStatuses.contains(status);
      return [
        Note(isEdit
            ? 'Change the tender — the change is recorded in its timeline.'
            : 'A published tender we may bid for: who floated it, its number and its key dates.'),
        const FormSection('Basic Information'),
        InputDecorator(
          decoration: fieldDecoration('Internal Tender ID'),
          child: Text(isEdit ? str(initial['universal_id']) : (previewNumber.isEmpty ? 'Auto-generated on save' : previewNumber),
              style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF2563EB))),
        ),
        DateField(label: 'Created Date', required: true, value: tenderDate, lastDate: DateTime.now(), onChanged: (d) => setS(() => tenderDate = d)),
        AppSelect<String>(
            label: 'Priority',
            required: true,
            value: priority,
            clearable: false,
            options: opts(CrmLists.priorities, label: CrmLists.priorityLabel),
            onChanged: (o) => setS(() => priority = o?.value ?? priority)),
        const FormSection('Customer Organization & Contact'),
        ...client.fields(ctx, setS,
            orgLabel: 'Customer Organization',
            contactRequired: false,
            locked: defaultOrgId != null,
            checkOpen: false,
            onOrgChanged: () {
              if (!isEdit && client.org != null) {
                setS(() {
                  railwayZone = str(client.org!['railway_zone']);
                  division = str(client.org!['division_workshop']);
                });
              }
            }),
        const FormSection('Tender Information'),
        AppTextField(label: 'Tender Number', required: need, controller: number),
        AppTextField(label: 'Tender Name', required: need, controller: name),
        AppTextField(label: 'Tender Authority', controller: authority),
        SelectWithOther(
            label: 'Tender Portal',
            options: CrmLists.tenderPortals,
            value: portal,
            other: portalOther,
            otherHint: 'Specify portal',
            onChanged: (v) => setS(() => portal = v)),
        AppSelect<String>(label: 'Tender Type', value: type, options: opts(CrmLists.tenderTypes), onChanged: (o) => setS(() => type = o?.value)),
        if (seePrices) AppTextField(label: 'Tender Value', controller: value, keyboardType: AppTextField.number),
        AppSelect<String>(
            label: 'Currency', value: currency, clearable: false, options: opts(CrmLists.currencies), onChanged: (o) => setS(() => currency = o?.value ?? currency)),
        AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: opts(keepCurrent(CrmLists.tenderStatuses, initial?['status'])),
            onChanged: (o) => setS(() => status = o?.value ?? status)),
        AppTextField(
            label: 'Tender Details',
            controller: details,
            maxLines: 3,
            hint: 'e.g. Supply of 2 rail grinding machines with 2 years AMC; eligibility: 3 similar supplies in last 5 years'),
        AppTextField(label: 'Current Status', controller: statusNote, maxLines: 2, hint: 'e.g. Waiting for client confirmation'),
        const FormSection('Key Dates'),
        DateField(label: 'Publish Date', required: need, value: publish, onChanged: (d) => setS(() => publish = d)),
        DateField(label: 'Document Download Date', value: docDownload, onChanged: (d) => setS(() => docDownload = d)),
        DateField(label: 'Submission Date', value: submission, onChanged: (d) => setS(() => submission = d)),
        Row(children: [
          Expanded(
              child: DateField(
                  label: 'Tender Closing Date', required: need, value: closingDate, onChanged: (d) => setS(() => closingDate = d))),
          const SizedBox(width: 8),
          SizedBox(
            width: 120,
            child: InkWell(
              onTap: () async {
                final p = closingTime.split(':');
                final t = await showTimePicker(
                    context: ctx, initialTime: TimeOfDay(hour: int.tryParse(p[0]) ?? 0, minute: int.tryParse(p.length > 1 ? p[1] : '0') ?? 0));
                if (t != null) {
                  setS(() => closingTime = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
                }
              },
              child: InputDecorator(decoration: fieldDecoration('Time'), child: Text(timeLabel(closingTime))),
            ),
          ),
        ]),
      ];
    },
    onSave: () async {
      if (client.orgId == null) throw 'Please select a customer organization.';
      if (!CrmLists.tenderNoDetailStatuses.contains(status)) {
        final missing = [
          if (number.text.trim().isEmpty) 'Tender Number',
          if (name.text.trim().isEmpty) 'Tender Name',
          if (publish == null) 'Publish Date',
          if (closingDate == null) 'Tender Closing Date',
        ];
        if (missing.isNotEmpty) {
          throw 'A tender with status "$status" needs ${missing.join(', ')}. Fill these in, or set the status to "Waiting for Future Tender" until the tender is published.';
        }
      }
      if (tenderDate == null) throw 'Please pick the Created Date — the day this tender was taken up.';
      if (isoDate(tenderDate).compareTo(todayIso()) > 0) {
        throw 'Created Date cannot be in the future. Pick the day the tender was actually taken up (today or earlier).';
      }
      final payload = <String, dynamic>{
        'org_id': client.orgId,
        'org_contact_id': client.contactId,
        'tender_number': number.text.trim(),
        'tender_name': name.text.trim(),
        'tender_authority': authority.text.trim(),
        'tender_portal': portal == 'Other' ? portalOther.text.trim() : portal,
        'tender_type': type,
        if (seePrices) 'tender_value': value.text.trim().isEmpty ? null : double.tryParse(value.text.trim()),
        'currency': currency,
        'status': status,
        'current_status_note': statusNote.text.trim(),
        'tender_details': details.text.trim(),
        'tender_date': apiDate(tenderDate!),
        'priority': priority,
        'railway_zone': railwayZone,
        'division': division,
        'publish_date': publish == null ? null : apiDate(publish!),
        'doc_download_date': docDownload == null ? null : apiDate(docDownload!),
        'submission_date': submission == null ? null : apiDate(submission!),
        'closing_at': closingDate == null ? null : '${apiDate(closingDate!)}T$closingTime:00',
      };
      payload.removeWhere((k, v) => v == null || v == '');
      if (isEdit && closingDate == null && initial['closing_at'] != null) payload['closing_at'] = null;
      final r = await guard(() => isEdit ? Api.patch('/crm/tenders/${initial['id']}', data: payload) : Api.post('/crm/tenders', data: payload));
      saved = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? saved : null;
}

/// fmtDate re-export for forms that only need dates.
String crmDate(Object? v) => fmtDate(v);
