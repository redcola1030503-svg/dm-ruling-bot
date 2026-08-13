import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../state/auth_provider.dart';

class CorrectionDialog extends StatefulWidget {
  final ApiClient apiClient;
  final String originalQuestion;
  final String botConclusion;

  const CorrectionDialog({
    super.key,
    required this.apiClient,
    required this.originalQuestion,
    required this.botConclusion,
  });

  @override
  State<CorrectionDialog> createState() => _CorrectionDialogState();
}

class _CorrectionDialogState extends State<CorrectionDialog> {
  final _correctRulingController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _correctRulingController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final correctRuling = _correctRulingController.text.trim();
    if (correctRuling.isEmpty) return;
    final token = context.read<AuthProvider>().session?.token;
    if (token == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.apiClient.postCorrection(
        token: token,
        originalQuestion: widget.originalQuestion,
        botConclusion: widget.botConclusion,
        correctRuling: correctRuling,
      );
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).pop();
      messenger.showSnackBar(const SnackBar(content: Text('訂正を記録しました')));
    } catch (e) {
      setState(() {
        _error = e is ApiException ? e.friendlyMessage : '記録に失敗しました: $e';
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('裁定を訂正'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('質問', style: Theme.of(context).textTheme.labelMedium),
            Text(widget.originalQuestion),
            const SizedBox(height: 12),
            Text('Botの結論', style: Theme.of(context).textTheme.labelMedium),
            Text(widget.botConclusion),
            const SizedBox(height: 16),
            TextField(
              controller: _correctRulingController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: '正しい裁定',
                border: OutlineInputBorder(),
              ),
              autofocus: true,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _loading ? null : () => Navigator.of(context).pop(),
          child: const Text('キャンセル'),
        ),
        FilledButton(
          onPressed: _loading ? null : _submit,
          child: _loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('記録する'),
        ),
      ],
    );
  }
}
