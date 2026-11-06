import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_requests.dart';
import 'design_reviews.dart';

/// Task rows (DesignTaskItem) shared by the Dashboard and My Work.

const taskLabels = <String, String>{
  'review': 'Check',
  'approve': 'Approve',
  'returned': 'Returned to you',
  'draft': 'Draft',
  'ecn_approve': 'ECN approval',
  'ecn_implement': 'ECN to implement',
  'bom_review': 'BOM check',
  'bom_approve': 'BOM approval',
  'bom_returned': 'BOM returned',
  'ecr_vote': 'ECR vote',
  'ecr_impact': 'ECR impact check',
  'ecr_decide': 'ECR decision',
  'ecn_acknowledge': 'ECN acknowledge',
  'release': 'Release (customer approved)',
  'customer_comment': 'Customer comment',
};

const taskColors = <String, Color>{
  'review': Color(0xFF2563EB),
  'approve': Color(0xFF7C3AED),
  'returned': Color(0xFFDC2626),
  'draft': Color(0xFF78716C),
  'ecn_approve': Color(0xFFF59E0B),
  'ecn_implement': Color(0xFF0F766E),
  'bom_review': Color(0xFF2563EB),
  'bom_approve': Color(0xFF7C3AED),
  'bom_returned': Color(0xFFDC2626),
  'ecr_vote': Color(0xFFF59E0B),
  'ecr_impact': Color(0xFFB45309),
  'ecr_decide': Color(0xFFF59E0B),
  'ecn_acknowledge': Color(0xFF0F766E),
  'release': Color(0xFF16A34A),
  'customer_comment': Color(0xFF0891B2),
};

String taskRef(Json t) {
  final kind = str(t['kind']);
  if (kind.startsWith('bom')) return '${str(t['bom_number']).isEmpty ? 'BOM' : t['bom_number']} ${str(t['revision_label'])}'.trim();
  if (kind.startsWith('ecr')) return str(t['ecr_number']).isEmpty ? 'ECR' : str(t['ecr_number']);
  if (kind.startsWith('ecn')) return str(t['ecn_number']).isEmpty ? 'ECN' : str(t['ecn_number']);
  if (kind == 'customer_comment') return str(t['comment']).isEmpty ? 'Customer comment' : str(t['comment']);
  return '${str(t['doc_number'])} ${str(t['revision_label'])}'.trim();
}

/// Opens the record behind a DesignTaskItem - the native version of the
/// portal's task links.
void openDesignTaskItem(BuildContext context, Json t, {VoidCallback? onReturn}) {
  final submission = asInt(t['submission_id']);
  final ecr = asInt(t['ecr_id']);
  final bom = asInt(t['bom_id']);
  final ecn = asInt(t['ecn_id']);
  final doc = asInt(t['document_id']);
  final link = str(t['link']);
  final kind = str(t['kind']);
  Widget? screen;
  if (submission != null) {
    screen = DesignSubmissionDetail(id: submission);
  } else if (ecr != null) {
    screen = DesignChangeRequestDetail(id: ecr);
  } else if (bom != null) {
    screen = DesignBomDetail(id: bom);
  } else if (ecn != null && (kind.startsWith('ecn') || doc == null)) {
    screen = DesignChangeNoticeDetail(id: ecn);
  } else if (doc != null) {
    screen = DesignDocumentDetail(id: doc);
  } else {
    final reqId = RegExp(r'/design/requests/(\d+)').firstMatch(link)?.group(1);
    if (reqId != null) screen = DesignRequestDetail(id: int.parse(reqId));
  }
  if (screen == null) {
    showSnack(context, 'This item has no record to open on the phone - open it from its own tab.', error: true);
    return;
  }
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen!)).then((_) => onReturn?.call());
}

/// Portal TaskRows: reference, title · by author, days waiting, kind pill.
class DesignTaskRows extends StatelessWidget {
  const DesignTaskRows(this.rows, {super.key, required this.empty, this.onReturn});
  final List<Json> rows;
  final String empty;
  final VoidCallback? onReturn;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return empty.isEmpty ? const SizedBox.shrink() : Text(empty, style: const TextStyle(fontSize: 13, color: Brand.muted));
    }
    return Column(children: [
      for (final t in rows)
        InkWell(
          onTap: () => openDesignTaskItem(context, t, onReturn: onReturn),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x140F172A)))),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(taskRef(t), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                  Text('${str(t['title'])}${str(t['author_name']).isEmpty ? '' : ' · by ${t['author_name']}'}',
                      maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
              ),
              const SizedBox(width: 8),
              Text((asInt(t['days_waiting']) ?? 0) == 0 ? 'today' : '${t['days_waiting']}d',
                  style: TextStyle(fontSize: 11, color: (asInt(t['days_waiting']) ?? 0) >= 7 ? Brand.danger : Brand.muted)),
              const SizedBox(width: 8),
              StatusBadge(taskLabels[str(t['kind'])] ?? humanize(t['kind']), color: taskColors[str(t['kind'])]),
            ]),
          ),
        ),
    ]);
  }
}
