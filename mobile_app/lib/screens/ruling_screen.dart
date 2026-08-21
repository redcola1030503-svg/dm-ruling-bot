import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/ruling_job.dart';
import '../state/auth_provider.dart';
import '../state/ruling_jobs_provider.dart';
import '../models/ruling_thread.dart';
import '../widgets/inline_card_suggest_field.dart';
import '../widgets/loading_banner_ad.dart';
import '../widgets/question_bubble.dart';
import '../widgets/ruling_result_view.dart';
import 'correction_dialog.dart';
import 'corrections_screen.dart';
import 'judges_screen.dart';
import 'card_index_screen.dart';
import 'login_screen.dart';
import 'ruling_thread_detail_screen.dart';
import 'usage_stats_screen.dart';

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
  void initState() {
    super.initState();
    final provider = context.read<RulingJobsProvider>();
    Future.microtask(() => provider.loadThreads());
  }

  @override
  void dispose() {
    _questionController.dispose();
    _questionFocusNode.dispose();
    super.dispose();
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
        _submitError = e is ApiException
            ? e.friendlyMessage
            : '通信エラーが発生しました: $e';
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
    final jobsProvider = context.watch<RulingJobsProvider>();
    final jobs = jobsProvider.jobs;
    final latestJob = jobs.isNotEmpty ? jobs.first : null;
    final threads = jobsProvider.threads;

    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: colorScheme.primary, width: 1.5),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10.5),
                child: const Image(
                  image: AssetImage('assets/icon/icon.png'),
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Text('DM裁定確認'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart),
            tooltip: 'ルール確認&利用統計',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => UsageStatsScreen(apiClient: widget.apiClient),
              ),
            ),
          ),
          if (auth.isLoggedIn)
            PopupMenuButton<String>(
              icon: const Icon(Icons.account_circle),
              onSelected: (value) {
                switch (value) {
                  case 'corrections':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            CorrectionsScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'judges':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            JudgesScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'card_index':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            CardIndexScreen(apiClient: widget.apiClient),
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
                  child: Text(
                    '${auth.session!.judgeId} (${auth.isAdmin ? '管理者' : 'ジャッジ'})',
                  ),
                ),
                PopupMenuItem(
                  value: 'corrections',
                  child: Text(auth.isAdmin ? '訂正内容(全ジャッジ)' : '自分の訂正内容'),
                ),
                if (auth.isAdmin)
                  const PopupMenuItem(value: 'judges', child: Text('ジャッジ管理')),
                if (auth.isAdmin)
                  const PopupMenuItem(
                    value: 'card_index',
                    child: Text('カードインデックス管理'),
                  ),
                const PopupMenuItem(value: 'logout', child: Text('ログアウト')),
              ],
            )
          else
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => LoginScreen(apiClient: widget.apiClient),
                ),
              ),
              child: const Text('ログイン'),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InlineCardSuggestField(
              apiClient: widget.apiClient,
              controller: _questionController,
              focusNode: _questionFocusNode,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: '質問を入力',
                hintText: '例: 《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？',
                helperText: '《の後にカード名を入力すると候補が出ます',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: colorScheme.primary,
                  foregroundColor: colorScheme.onPrimary,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
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
                QuestionBubble(question: latestJob.question),
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
                          SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
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
            if (threads.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('質問スレッド', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...threads.map(
                (thread) => Card(
                  child: ListTile(
                    title: Text(
                      thread.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(_threadStatusLabel(thread)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            RulingThreadDetailScreen(threadId: thread.threadId),
                      ),
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

  String _threadStatusLabel(RulingThreadSummary thread) {
    final latest = thread.latestJob;
    if (latest == null) return '${thread.jobCount}件の質問';
    switch (latest.status) {
      case 'pending':
      case 'running':
        return '生成中…';
      case 'failed':
        return 'エラーが発生しました';
      default:
        return latest.conclusion ?? '完了';
    }
  }
}
