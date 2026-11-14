import 'package:flutter/material.dart';

import '../theme.dart';
import 'files.dart';

/// App-wide card at the bottom while a file downloads (attachments, PDFs,
/// Word documents, drawings): name, spinning loader, progress %, Cancel.
class DownloadOverlay extends StatelessWidget {
  const DownloadOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<FileTransfer?>(
      valueListenable: Files.transfer,
      builder: (context, t, _) {
        if (t == null) return const SizedBox.shrink();
        final f = t.fraction;
        final status = f == null ? 'Downloading…' : 'Downloading ${(f * 100).round()}%';
        return Align(
          alignment: Alignment.bottomCenter,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 80),
              child: Material(
                elevation: 6,
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2.5, color: Brand.primary),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(t.fileName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                                Text(status, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: () => t.cancelToken.cancel(),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: f, // null = moving bar when the size is unknown
                            minHeight: 5,
                            color: Brand.primary,
                            backgroundColor: Brand.primarySoft,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
