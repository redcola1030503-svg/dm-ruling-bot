import 'dart:async';

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
import '../utils/share_ruling.dart';
import 'correction_dialog.dart';
import 'paywall_screen.dart';
import 'ruling_thread_detail_screen.dart';
import 'settings_screen.dart';

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
  RulingUsage? _usage;

  @override
  void initState() {
    super.initState();
    final provider = context.read<RulingJobsProvider>();
    Future.microtask(() => provider.loadThreads());
    Future.microtask(() => _refreshUsage(provider));
  }

  /// 残り無料質問回数を取り直す。初期表示・質問送信後・スレッド詳細から
  /// 戻った直後(フォローアップ質問も無料枠を消費する)に呼ぶ。
  /// 失敗しても表示を据え置くだけで、例外は外へ出さない
  /// (unawaitedで呼んでも未処理の非同期エラーにならない)。
  Future<void> _refreshUsage(RulingJobsProvider provider) async {
    try {
      final deviceId = await provider.deviceIdProvider.getOrCreate();
      final usage = await widget.apiClient.getRulingUsage(deviceId);
      if (mounted) setState(() => _usage = usage);
    } catch (_) {
      // 取得失敗時は表示を更新しない(質問送信自体には影響しない)
    }
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
    final jobsProvider = context.read<RulingJobsProvider>();
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    try {
      await jobsProvider.submitQuestion(question);
      _questionController.clear();
      unawaited(_refreshUsage(jobsProvider));
    } catch (e) {
      if (e is ApiException && e.isSubscriptionRequired) {
        if (!mounted) return;
        final purchased = await Navigator.push<bool>(
          context,
          MaterialPageRoute(
            builder: (_) => PaywallScreen(apiClient: widget.apiClient),
          ),
        );
        if (purchased == true) {
          // 購読完了後、同じ質問を自動的に再送信する。
          await _submit();
          return;
        }
      } else {
        setState(() {
          _submitError = e is ApiException
              ? e.friendlyMessage
              : '通信エラーが発生しました: $e';
        });
      }
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

  Future<void> _confirmDeleteThread(RulingThreadSummary thread) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('スレッドを削除しますか？'),
        content: Text('「${thread.title}」を削除します。この操作は取り消せません。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('キャンセル'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('削除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await context.read<RulingJobsProvider>().deleteThread(thread.threadId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException ? e.friendlyMessage : '削除に失敗しました: $e',
          ),
        ),
      );
    }
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
                // アイコン画像自体に薄い余白があり、枠との間に隙間として
                // 見えるため、少し拡大してトリミングし余白を消す。
                child: Transform.scale(
                  scale: 1.12,
                  // カラーパターン変更時にアイコンも同系色になるよう、
                  // 選択中のアクセントカラーで色相を差し替える
                  // (BlendMode.colorは元画像の明暗を保ったまま色相・彩度だけ置き換える)。
                  child: ColorFiltered(
                    colorFilter: ColorFilter.mode(
                      colorScheme.primary,
                      BlendMode.color,
                    ),
                    child: const Image(
                      image: AssetImage('assets/icon/icon.png'),
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Text('DM裁定確認'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'オプション',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => SettingsScreen(apiClient: widget.apiClient),
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_usage != null && !_usage!.subscriptionActive)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '今月の残り無料質問回数: ${_usage!.remainingFree}回',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            InlineCardSuggestField(
              apiClient: widget.apiClient,
              controller: _questionController,
              focusNode: _questionFocusNode,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: '質問を入力',
                hintText: '例: 《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？',
                helperText: '長押しでカード名を入力',
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
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: () =>
                          shareRuling(latestJob.question, latestJob.result!),
                      icon: const Icon(Icons.share_outlined, size: 18),
                      label: const Text('共有'),
                    ),
                    if (auth.isLoggedIn)
                      OutlinedButton(
                        onPressed: () => _openCorrectionDialog(latestJob),
                        child: const Text('この裁定を訂正する'),
                      ),
                  ],
                ),
              ],
            ],
            if (threads.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('質問スレッド', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              ...threads.map((thread) {
                final isFavorite = jobsProvider.isFavoriteThread(
                  thread.threadId,
                );
                return Card(
                  child: ListTile(
                    leading: IconButton(
                      icon: Icon(
                        isFavorite ? Icons.star : Icons.star_border,
                        color: isFavorite ? Colors.amber : null,
                      ),
                      tooltip: isFavorite ? 'お気に入りを解除' : 'お気に入りに追加',
                      onPressed: () =>
                          jobsProvider.toggleFavoriteThread(thread.threadId),
                    ),
                    title: Text(
                      thread.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(_threadStatusLabel(thread)),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      tooltip: 'スレッドを削除',
                      onPressed: () => _confirmDeleteThread(thread),
                    ),
                    onTap: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => RulingThreadDetailScreen(
                            threadId: thread.threadId,
                          ),
                        ),
                      );
                      // スレッド詳細でのフォローアップ質問も無料枠を消費するため、
                      // 戻ってきたタイミングで残り回数を取り直す。
                      await _refreshUsage(jobsProvider);
                    },
                  ),
                );
              }),
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
