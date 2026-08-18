import 'package:extended_text_field/extended_text_field.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/ruling_job.dart';
import '../state/auth_provider.dart';
import '../state/ruling_jobs_provider.dart';
import '../widgets/card_name_special_text.dart';
import '../widgets/card_suggest_field.dart';
import '../widgets/loading_banner_ad.dart';
import '../widgets/ruling_result_view.dart';
import 'correction_dialog.dart';
import 'corrections_screen.dart';
import 'judges_screen.dart';
import 'card_index_screen.dart';
import 'login_screen.dart';
import 'ruling_job_detail_screen.dart';

class RulingScreen extends StatefulWidget {
  final ApiClient apiClient;

  const RulingScreen({super.key, required this.apiClient});

  @override
  State<RulingScreen> createState() => _RulingScreenState();
}

class _RulingScreenState extends State<RulingScreen> {
  final _questionController = TextEditingController();
  final _questionFocusNode = FocusNode();
  bool _submitting = false;
  String? _submitError;

  @override
  void dispose() {
    _questionController.dispose();
    _questionFocusNode.dispose();
    super.dispose();
  }

  void _insertCardName(String name) {
    final text = _questionController.text;
    final selection = _questionController.selection;
    final insertion = '《$name》';
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    final newText = text.replaceRange(start, end, insertion);
    _questionController.value = _questionController.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(offset: start + insertion.length),
    );
    _questionFocusNode.requestFocus();
  }

  Future<void> _submit() async {
    final question = _questionController.text.trim();
    if (question.isEmpty) return;
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    try {
      await context.read<RulingJobsProvider>().submitQuestion(question);
      _questionController.clear();
    } catch (e) {
      setState(() {
        _submitError = e is ApiException ? e.friendlyMessage : '通信エラーが発生しました: $e';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _openCorrectionDialog(RulingJob job) {
    if (job.result == null) return;
    showDialog(
      context: context,
      builder: (_) => CorrectionDialog(
        apiClient: widget.apiClient,
        originalQuestion: job.question,
        botConclusion: job.result!.conclusion,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final jobs = context.watch<RulingJobsProvider>().jobs;
    final latestJob = jobs.isNotEmpty ? jobs.first : null;
    final olderJobs = jobs.length > 1 ? jobs.sublist(1) : const <RulingJob>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('DM裁定確認'),
        actions: [
          if (auth.isLoggedIn)
            PopupMenuButton<String>(
              icon: const Icon(Icons.account_circle),
              onSelected: (value) {
                switch (value) {
                  case 'corrections':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CorrectionsScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'judges':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => JudgesScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'card_index':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CardIndexScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'logout':
                    context.read<AuthProvider>().logout();
                    break;
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  enabled: false,
                  child: Text('${auth.session!.judgeId} (${auth.isAdmin ? '管理者' : 'ジャッジ'})'),
                ),
                PopupMenuItem(
                  value: 'corrections',
                  child: Text(auth.isAdmin ? '訂正内容(全ジャッジ)' : '自分の訂正内容'),
                ),
                if (auth.isAdmin) const PopupMenuItem(value: 'judges', child: Text('ジャッジ管理')),
                if (auth.isAdmin) const PopupMenuItem(value: 'card_index', child: Text('カードインデックス管理')),
                const PopupMenuItem(value: 'logout', child: Text('ログアウト')),
              ],
            )
          else
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => LoginScreen(apiClient: widget.apiClient)),
              ),
              child: const Text('ログイン', style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CardSuggestField(apiClient: widget.apiClient, onSelected: _insertCardName),
            const SizedBox(height: 12),
            ExtendedTextField(
              controller: _questionController,
              focusNode: _questionFocusNode,
              maxLines: 5,
              textDirection: TextDirection.ltr,
              specialTextSpanBuilder: QuestionSpecialTextSpanBuilder(),
              decoration: const InputDecoration(
                labelText: '質問を入力',
                hintText: '例: 《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('質問する'),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '送信後は画面を離れたりアプリを閉じたりしても裁定生成は続行され、完了すると通知でお知らせします。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_submitError != null) ...[
              const SizedBox(height: 16),
              Text(_submitError!, style: const TextStyle(color: Colors.red)),
            ],
            if (latestJob != null) ...[
              const SizedBox(height: 16),
              if (latestJob.question.isNotEmpty) ...[
                Text('質問', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 4),
                SelectableText(latestJob.question),
                const SizedBox(height: 8),
              ],
              if (!latestJob.isFinished)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                          SizedBox(width: 12),
                          Expanded(
                            child: Text('公式情報の検索とLLMによる裁定生成を行っています(最大数分程度)…'),
                          ),
                        ],
                      ),
                      SizedBox(height: 12),
                      LoadingBannerAd(),
                    ],
                  ),
                )
              else if (latestJob.status == RulingJobStatus.failed)
                Text(
                  latestJob.error ?? '裁定生成中にエラーが発生しました。',
                  style: const TextStyle(color: Colors.red),
                )
              else if (latestJob.result != null) ...[
                RulingResultView(result: latestJob.result!),
                if (auth.isLoggedIn) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => _openCorrectionDialog(latestJob),
                    child: const Text('この裁定を訂正する'),
                  ),
                ],
              ],
            ],
            if (olderJobs.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('これまでの質問', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...olderJobs.map(
                (job) => Card(
                  child: ListTile(
                    title: Text(
                      job.question,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(_statusLabel(job)),
                    trailing: !job.isFinished
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => RulingJobDetailScreen(jobId: job.jobId)),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _statusLabel(RulingJob job) {
    switch (job.status) {
      case RulingJobStatus.pending:
      case RulingJobStatus.running:
        return '生成中…';
      case RulingJobStatus.failed:
        return 'エラーが発生しました';
      case RulingJobStatus.done:
        return job.result?.conclusion ?? '完了';
    }
  }
}
