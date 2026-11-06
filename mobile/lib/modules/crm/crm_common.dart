import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

// ── Permissions (frontend/src/lib/permissions.ts + tabAccess.ts) ─────────────

class CrmPerm {
  CrmPerm._();

  /// CRM sub-nav tab visible (portal filterTabsByAccess: no tab_access entry = every tab).
  static bool tab(String key) {
    if (Perm.isAdmin) return true;
    final ta = Perm.user['tab_access'];
    if (ta is Map && ta['crm'] is List) return (ta['crm'] as List).contains(key);
    return true;
  }

  static bool can(String tab, String action) => Perm.can('crm', tab, action);
  static bool feat(String tab, String feature, String action) => Perm.canFeature('crm', tab, feature, action);
  static bool it(String feature, String action) => Perm.canFeature('crm', 'inquiries_tenders', feature, action);

  /// Creator-or-admin (backend rule on edits).
  static bool ownerOrAdmin(Object? createdById) => Perm.isAdmin || (createdById != null && createdById == Perm.userId);

  /// portal canDelete: Delete on the tab AND own record (admins any).
  static bool canDelete(String tab, Object? ownerId) {
    if (!can(tab, 'delete')) return false;
    if (Perm.isAdmin) return true;
    return ownerId == null || ownerId == Perm.userId;
  }

  /// Quotation prices visible (crm/access.py sees_quotation_prices).
  static bool get seesQuotePrices =>
      it('prices', 'view') || it('quotations', 'create') || it('quotations', 'edit') || it('quotations', 'approve');
}

// ── Errors ───────────────────────────────────────────────────────────────────

/// The server's own reason, including FastAPI validation lists (422).
String crmError(Object e) {
  if (e is String) return e;
  if (e is DioException) {
    final data = e.response?.data;
    final detail = data is Map ? data['detail'] : null;
    if (detail is List) {
      final msgs = <String>[];
      for (final d in detail) {
        if (d is Map) {
          var m = (d['msg'] ?? '').toString().replaceFirst('Value error, ', '');
          final loc = d['loc'];
          if (loc is List && loc.length > 1 && !m.contains(' ')) m = '${loc.last}: $m';
          if (m.isNotEmpty) msgs.add(m);
        } else if (d != null) {
          msgs.add(d.toString());
        }
      }
      if (msgs.isNotEmpty) return msgs.join('\n');
    }
  }
  return ApiClient.describe(e);
}

/// Runs an API call and turns its failure into the readable reason (for showFormSheet).
Future<T> guard<T>(Future<T> Function() fn) async {
  try {
    return await fn();
  } catch (e) {
    throw crmError(e);
  }
}

/// Server action with a snack for the result (crmError text); true when it worked.
Future<bool> crmRun(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (context.mounted && success != null) showSnack(context, success);
    return true;
  } catch (e) {
    if (context.mounted) showSnack(context, crmError(e), error: true);
    return false;
  }
}

// ── Values ───────────────────────────────────────────────────────────────────

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));
num? asNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
String str(Object? v) => v == null ? '' : v.toString();
List<Json> jsonList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];
List<String> strList(Object? v) => v is List ? v.where((x) => x != null).map((x) => x.toString()).toList() : <String>[];

String joinNonEmpty(Iterable<Object?> parts, [String sep = ', ']) =>
    parts.map((p) => p?.toString().trim() ?? '').where((p) => p.isNotEmpty).join(sep);

String todayIso() => DateTime.now().toIso8601String().substring(0, 10);

DateTime? dateOf(Object? v) => (v is String && v.isNotEmpty) ? DateTime.tryParse(v) : null;

String isoDate(DateTime? d) => d == null ? '' : d.toIso8601String().substring(0, 10);

/// "<p>Hi</p>" → "Hi" (portal stripHtml for rich-text remarks).
String stripHtml(Object? html) {
  final s = str(html)
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p>\s*<p[^>]*>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");
  return s.trim();
}

/// Plain text typed on the phone → the simple HTML the portal's rich-text editor keeps.
String toHtml(String text) {
  final t = text.trim();
  if (t.isEmpty) return '';
  String esc(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return t.split('\n').map((l) => '<p>${esc(l)}</p>').join();
}

String money(Object? v, {bool export = false}) {
  final n = asNum(v);
  if (n == null) return '—';
  return export ? '\$${fmtAmount(n)}' : '₹${fmtAmount(n)}';
}

String fmtAmount(num n) {
  final neg = n < 0;
  final fixed = n.abs().toStringAsFixed(2);
  final parts = fixed.split('.');
  var intPart = parts[0];
  // Indian grouping: last 3, then 2s.
  if (intPart.length > 3) {
    final last3 = intPart.substring(intPart.length - 3);
    var rest = intPart.substring(0, intPart.length - 3);
    final groups = <String>[];
    while (rest.length > 2) {
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) groups.insert(0, rest);
    intPart = '${groups.join(',')},$last3';
  }
  return '${neg ? '-' : ''}$intPart.${parts[1]}';
}

String fmtQty(Object? v) {
  final n = asNum(v);
  if (n == null) return '—';
  return n == n.roundToDouble() ? n.toInt().toString() : n.toString();
}

// ── Fixed lists (frontend/src/components/crm/constants.ts) ───────────────────

class CrmLists {
  CrmLists._();

  static const railwayZones = [
    'Northern Railway', 'Southern Railway', 'Eastern Railway', 'Western Railway', 'Central Railway',
    'South Eastern Railway', 'North Eastern Railway', 'Northeast Frontier Railway', 'South Central Railway',
    'East Central Railway', 'East Coast Railway', 'West Central Railway', 'North Central Railway',
    'North Western Railway', 'South Western Railway', 'Metro Railway Kolkata', 'Not Applicable', 'Other',
  ];

  static const designations = [
    'Owner / Proprietor', 'Founder / Co-Founder', 'Chairman', 'Managing Director (MD)', 'Chief Executive Officer (CEO)',
    'Director', 'General Manager (GM)', 'Deputy General Manager (DGM)', 'Assistant General Manager (AGM)', 'Plant Head',
    'Factory Manager', 'Operations Manager', 'Production Manager', 'Purchase Head', 'Purchase Manager',
    'Procurement Executive', 'Project Manager', 'Design Head', 'Design Engineer', 'R&D Manager',
    'Technical Manager', 'Maintenance Manager', 'Quality Manager', 'Quality Engineer', 'Electrical Engineer',
    'Mechanical Engineer', 'Service Manager', 'Sales Manager', 'Business Development Manager', 'Finance Manager',
    'Accounts Manager', 'HR Manager', 'Store Manager', 'Supervisor', 'Executive',
    'Assistant', 'Consultant', 'Other',
  ];

  static const departments = [
    'Sales', 'Marketing', 'Business Development', 'Purchase / Procurement', 'Design & Engineering',
    'Research & Development (R&D)', 'Production / Manufacturing', 'Project Management', 'Operations',
    'Quality Assurance / Quality Control', 'Service & Commissioning', 'Maintenance', 'Accounts & Finance',
    'Administration', 'Human Resources (HR)', 'Technical Support', 'Customer Service',
    'Supply Chain & Logistics', 'Export & Import', 'Other',
  ];

  static const activityTypes = ['Call', 'Email', 'Meet at Client/Site Office', 'Meet at Own Office'];
  static const followUpStatuses = ['Open', 'Closed', 'Hold'];

  static const orgTypesDomestic = ['PSU', 'Govt Department', 'Railway', 'Private', 'Joint Venture', 'Other'];
  static const orgTypesInternational = [
    'Government Department', 'Railway', 'Private Company', 'Joint Venture', 'Public Enterprise', 'Other',
  ];
  static List<String> orgTypesFor(String scope) => scope == 'international' ? orgTypesInternational : orgTypesDomestic;
  static String orgTypeLabel(String t) => t == 'PSU' ? 'Public Sector Undertaking (PSU)' : t;
  static bool hasRailwayFields(String? t) => t == 'Railway' || t == 'Govt Department' || t == 'Government Department';

  static const indiaStates = [
    'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
    'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
    'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh',
    'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
    'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  ];

  static const _world = [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
    'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
    'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
    'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Republic)',
    'Costa Rica', "Cote d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo', 'Denmark',
    'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
    'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
    'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'Indonesia', 'Iran', 'Iraq',
    'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
    'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
    'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova',
    'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
    'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau',
    'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia',
    'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
    'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
    'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
    'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
    'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
    'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
  ];

  /// India first, every other country A-Z, 'Other' last.
  static final countries = ['India', ...(List<String>.of(_world)..sort()), 'Other'];

  static const leadSources = ['Website', 'WhatsApp', 'Referral', 'Phone Call', 'Email', 'Walk-in', 'LinkedIn', 'Exhibition/Event', 'Other'];

  static const priorities = ['standard', 'urgent'];
  static String priorityLabel(Object? p) {
    final v = normalizePriority(p);
    return v == 'urgent'
        ? 'Urgent — Important requirement, quick action needed'
        : 'Standard — Normal requirement';
  }

  static String normalizePriority(Object? p) {
    final v = str(p).toLowerCase();
    return (v == 'urgent' || v == 'high' || v == 'critical') ? 'urgent' : 'standard';
  }

  static const inquiryStatuses = [
    'Lead', 'Requirement Received', 'R&D / Technical Review', 'Qualified Inquiry', 'Quotation Sent',
    'Order Received', 'Closed - Ordered', 'Closed - Not Ordered',
  ];
  static const lostStatus = 'Closed - Not Ordered';

  static const tenderStatuses = [
    'Waiting for Future Tender', 'Tender Published', 'Tender Participation', 'Tender Submitted',
    'LOA / Order Received', 'Closed – Ordered', 'Closed – Not Ordered', 'Tender Cancelled',
  ];
  static const tenderNoDetailStatuses = ['Waiting for Future Tender', 'Tender Cancelled'];

  static const tenderStages = [
    'Tender Published', 'Documents Downloaded', 'Participate Decision', 'Bid Submitted',
    'Technical Qualified', 'Financial Opened', 'Awarded / Lost',
  ];

  static const tenderPortals = ['GeM', 'IREPS', 'CPP Portal', 'eProcure', 'Direct', 'Other'];
  static const tenderTypes = ['Open', 'Limited', 'Single', 'Global'];
  static const currencies = ['INR', 'USD', 'EUR'];
  static const quoteConditions = ['Standard T&C', 'Ex-works', 'FOR Destination', 'FOB', 'CIF', 'Other/Custom'];

  static const _inqColors = {
    'Lead': Color(0xFF475569),
    'Requirement Received': Color(0xFF1D4ED8),
    'R&D / Technical Review': Color(0xFF0369A1),
    'Qualified Inquiry': Color(0xFFA16207),
    'Quotation Sent': Color(0xFF7C3AED),
    'Order Received': Color(0xFF047857),
    'Under Production': Color(0xFFB45309),
    'Closed - Ordered': Color(0xFF16A34A),
    'Closed - Not Ordered': Color(0xFFB91C1C),
  };
  static Color inquiryColor(Object? s) => _inqColors[str(s)] ?? const Color(0xFF57534E);

  static const _tndColors = {
    'Waiting for Future Tender': Color(0xFF1D4ED8),
    'Tender Published': Color(0xFF1D4ED8),
    'Tender Participation': Color(0xFFA16207),
    'Tender Submitted': Color(0xFF7C3AED),
    'LOA / Order Received': Color(0xFF16A34A),
    'Closed – Ordered': Color(0xFF16A34A),
    'Closed – Not Ordered': Color(0xFFB91C1C),
    'Tender Cancelled': Color(0xFF57534E),
  };
  static Color tenderColor(Object? s) => _tndColors[str(s)] ?? const Color(0xFF57534E);

  static const lostReasonLabels = {
    'price': 'Price too high', 'technical': 'Technical / specification', 'delivery': 'Delivery period',
    'budget_dropped': 'Budget dropped', 'competitor': 'Lost to competitor', 'no_response': 'No response', 'other': 'Other',
  };
}

List<Option<String>> opts(Iterable<String> values, {String Function(String)? label}) =>
    [for (final v in values) Option(v, label == null ? v : label(v))];

/// The record's own value stays selectable even when it is no longer in the list.
List<String> keepCurrent(List<String> choices, Object? current) {
  final c = str(current);
  return c.isNotEmpty && !choices.contains(c) ? [...choices, c] : choices;
}

// ── Shared loaders ───────────────────────────────────────────────────────────

/// Every customer organization for pick-lists (portal: listOrganizations({picker: true})).
Future<List<Option<int>>> loadOrgOptions(String search) async {
  final rows = (await Api.list('/crm/organizations', query: {'picker': true, 'search': search, 'limit': 200})).rows;
  return [
    for (final o in rows)
      if (asInt(o['id']) != null) Option(asInt(o['id'])!, str(o['name']), subtitle: joinNonEmpty([o['org_type'], o['city']], ' · ')),
  ];
}

Future<List<Json>> loadContacts(int orgId) async => (await Api.list('/crm/organizations/$orgId/contacts')).rows;

Future<List<Json>> loadDirectory() async => (await Api.list('/users/directory')).rows;

// ── Documents ────────────────────────────────────────────────────────────────

/// Opens a CRM document: big files through a short-lived SharePoint link, the rest downloaded and opened.
Future<void> openCrmDocument(BuildContext context, Json doc) async {
  final id = asInt(doc['id']);
  if (id == null) return;
  await crmRun(context, () async {
    final size = asInt(doc['file_size']) ?? 0;
    if (size > 50 * 1024 * 1024) {
      final r = await Api.get('/crm/documents/$id/download-url');
      final url = r is Map ? str(r['url']) : '';
      if (url.isEmpty) throw 'The server gave no download link for ${str(doc['file_name'])}. Try again in a minute.';
      await Files.openUrl(url);
    } else {
      await Files.downloadAndOpen('/crm/documents/$id/content', str(doc['file_name']).isEmpty ? 'document-$id' : str(doc['file_name']));
    }
  });
}

/// Download an API file and open it, reporting the real reason on failure.
Future<void> openApiFile(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) =>
    crmRun(context, () => Files.downloadAndOpen(path, fileName, query: query));

/// POST that returns a file (MOM export): saves it and opens it.
Future<void> postAndOpenFile(BuildContext context, String path, Object? body, String fileName) => crmRun(context, () async {
      final res = await Api.dio.post<List<int>>(path,
          data: body,
          options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 2)));
      await saveBytesAndOpen(res.data ?? const [], fileName);
    });

/// Writes downloaded bytes to the phone's temp folder and opens them in the viewer app.
Future<void> saveBytesAndOpen(List<int> bytes, String fileName) async {
  final dir = await getTemporaryDirectory();
  final safe = fileName.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
  final file = File('${dir.path}${Platform.pathSeparator}$safe');
  await file.writeAsBytes(bytes, flush: true);
  final r = await OpenFilex.open(file.path);
  if (r.type != ResultType.done) {
    throw 'The file was saved but no app on this phone can open "$safe". '
        'Install a viewer for this file type (for example Microsoft Word or a PDF reader).';
  }
}

// ── Small widgets ────────────────────────────────────────────────────────────

ButtonStyle _pill(Color bg, Color fg, {Color? side}) => FilledButton.styleFrom(
      backgroundColor: bg,
      foregroundColor: fg,
      minimumSize: const Size(0, 42),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12), side: side == null ? BorderSide.none : BorderSide(color: side)),
    );

Widget primaryBtn(String label, VoidCallback? onPressed, {IconData? icon}) => FilledButton(
      style: _pill(Brand.primary, Colors.white),
      onPressed: onPressed,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 6)],
        Text(label),
      ]),
    );

Widget secondaryBtn(String label, VoidCallback? onPressed, {IconData? icon}) => FilledButton(
      style: _pill(Colors.white, Brand.body, side: Brand.border),
      onPressed: onPressed,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 6)],
        Text(label),
      ]),
    );

Widget dangerBtn(String label, VoidCallback? onPressed) =>
    FilledButton(style: _pill(Brand.dangerSoft, Brand.danger, side: Brand.danger.withValues(alpha: 0.3)), onPressed: onPressed, child: Text(label));

Widget wordBtn(String label, VoidCallback? onPressed) => FilledButton(
      style: _pill(const Color(0xFF2563EB), Colors.white),
      onPressed: onPressed,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.description_outlined, size: 18),
        const SizedBox(width: 6),
        Text(label),
      ]),
    );

/// The sticky bottom bar's buttons, wrapped to as many rows as needed.
Widget actionBar(List<Widget> buttons) => Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.end, children: buttons);

/// Coloured pill with a fixed colour (portal Pill).
Widget pill(Object? text, Color color) => StatusBadge(text, color: color);

/// Record sub-tabs (portal segment buttons).
class SubTabs extends StatelessWidget {
  const SubTabs({super.key, required this.tabs, required this.index, required this.onChanged});
  final List<String> tabs;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        itemCount: tabs.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (ctx, i) {
          final sel = i == index;
          return Material(
            color: sel ? Brand.primarySoft : Colors.white,
            shape: StadiumBorder(side: BorderSide(color: sel ? Brand.primary : Brand.border)),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () => onChanged(i),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Center(
                  child: Text(tabs[i],
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: sel ? FontWeight.w700 : FontWeight.w500,
                          color: sel ? Brand.primaryActive : Brand.body)),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Small grey note / hint text.
class Note extends StatelessWidget {
  const Note(this.text, {super.key, this.color = Brand.muted, this.padding = EdgeInsets.zero});
  final String text;
  final Color color;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: padding, child: Text(text, style: TextStyle(fontSize: 12.5, color: color)));
}

/// Coloured info / warning box.
class InfoBox extends StatelessWidget {
  const InfoBox(this.text, {super.key, this.color = const Color(0xFF1E40AF), this.bg = const Color(0xFFEFF6FF)});
  final String text;
  final Color color;
  final Color bg;

  const InfoBox.warn(this.text, {super.key})
      : color = const Color(0xFFA16207),
        bg = const Color(0xFFFFFBEB);

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: color.withValues(alpha: 0.3))),
        child: Text(text, style: TextStyle(color: color, fontSize: 13)),
      );
}

/// Section heading inside a form sheet.
class FormSection extends StatelessWidget {
  const FormSection(this.title, {super.key});
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading)),
      );
}

/// Square icon button that sits inside a field row ("+ Add another", "Remove") - never a link under the field.
Widget rowIconButton(IconData icon, String tooltip, VoidCallback? onPressed, {Color color = Brand.primary}) => Padding(
      padding: const EdgeInsets.only(left: 8),
      child: SizedBox(
        width: 44,
        height: 44,
        child: IconButton.outlined(
          tooltip: tooltip,
          style: IconButton.styleFrom(
            foregroundColor: color,
            side: BorderSide(color: onPressed == null ? Brand.border : color.withValues(alpha: 0.5)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          onPressed: onPressed,
          icon: Icon(icon, size: 20),
        ),
      ),
    );

/// A field with "more values" (phones / emails): the main value plus extra rows,
/// "+" icon button in the main row, remove icon in each extra row.
class MultiValues {
  MultiValues(String primary, Iterable<String> extras)
      : main = TextEditingController(text: primary),
        extras = [for (final e in extras) TextEditingController(text: e)];

  final TextEditingController main;
  final List<TextEditingController> extras;

  String get first => main.text.trim();
  List<String> get rest => extras.map((c) => c.text.trim()).where((s) => s.isNotEmpty).toList();
  bool get canAdd => first.isNotEmpty && extras.every((c) => c.text.trim().isNotEmpty);
}

class MultiValueField extends StatelessWidget {
  const MultiValueField({
    super.key,
    required this.label,
    required this.values,
    required this.setState,
    this.keyboardType,
    this.hint,
    this.addTooltip = 'Add another',
    this.required = false,
  });

  final String label;
  final MultiValues values;
  final StateSetter setState;
  final TextInputType? keyboardType;
  final String? hint;
  final String addTooltip;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(
            child: TextField(
              controller: values.main,
              keyboardType: keyboardType,
              onChanged: (_) => setState(() {}),
              decoration: fieldDecoration(label, required: required, hint: hint),
            ),
          ),
          rowIconButton(Icons.add_rounded, values.canAdd ? addTooltip : 'Fill in the $label first.',
              values.canAdd ? () => setState(() => values.extras.add(TextEditingController())) : null),
        ]),
        for (var i = 0; i < values.extras.length; i++)
          Padding(
            key: ObjectKey(values.extras[i]),
            padding: const EdgeInsets.only(top: 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: values.extras[i],
                  keyboardType: keyboardType,
                  onChanged: (_) => setState(() {}),
                  decoration: fieldDecoration('$label ${i + 2}', hint: hint),
                ),
              ),
              rowIconButton(Icons.close_rounded, 'Remove', () => setState(() => values.extras.removeAt(i)),
                  color: Brand.danger),
            ]),
          ),
      ],
    );
  }
}

/// AppSelect with an "Other" choice that opens a free-text box below.
class SelectWithOther extends StatelessWidget {
  const SelectWithOther({
    super.key,
    required this.label,
    required this.options,
    required this.value,
    required this.other,
    required this.onChanged,
    required this.otherHint,
    this.required = false,
    this.otherValue = 'Other',
  });

  final String label;
  final List<String> options;

  /// Picked list value ('' = none).
  final String value;
  final TextEditingController other;
  final ValueChanged<String> onChanged;
  final String otherHint;
  final bool required;
  final String otherValue;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      AppSelect<String>(
        label: label,
        required: required,
        value: value.isEmpty ? null : value,
        options: opts(options),
        onChanged: (o) => onChanged(o?.value ?? ''),
      ),
      if (value == otherValue) ...[
        const SizedBox(height: 8),
        TextField(controller: other, decoration: fieldDecoration(otherHint)),
      ],
    ]);
  }
}

/// Splits a saved value into (list value, typed "Other" text).
(String, String) splitOther(Object? saved, List<String> list) {
  final s = str(saved);
  if (s.isEmpty) return ('', '');
  return list.contains(s) ? (s, '') : ('Other', s);
}

/// One label/value line inside a DetailSection; hidden when empty and [hideEmpty].
Widget row(String label, Object? value, {bool hideEmpty = false, String empty = '—'}) {
  final v = value is Widget ? value : (str(value).trim().isEmpty ? null : str(value));
  if (v == null && hideEmpty) return const SizedBox.shrink();
  return FieldRow(label, v ?? empty);
}

/// The 4 time-ago words used on the dashboard.
String timeAgo(Object? iso) {
  final d = dateOf(iso);
  if (d == null) return '';
  final mins = DateTime.now().difference(d.toLocal()).inMinutes;
  if (mins < 1) return 'just now';
  if (mins < 60) return '$mins min ago';
  final hrs = (mins / 60).round();
  if (hrs < 24) return '$hrs h ago';
  final days = (hrs / 24).round();
  return days == 1 ? 'yesterday' : '$days days ago';
}

/// Picks one or more files (any type).
Future<List<MultipartFile>> pickDocs() => Files.pickFiles();
