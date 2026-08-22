import 'package:flutter/material.dart';

import '../models/ruling_job.dart';
import '../utils/share_ruling.dart';
import 'loading_banner_ad.dart';
import 'question_bubble.dart';
import 'ruling_result_view.dart';

/// 1つの質問+回答(1ターン分)の表示。RulingJobDetailScreen・
/// RulingThreadDetailScreenの両方から使う共通ウィジェット。
class RulingTurnView extends StatelessWidget {
  final RulingJob job;
  final bool showQuestion;
  final bool isLoggedIn;
  final VoidCallback? onCorrect;

  const RulingTurnView({
    super.key,
    required this.job,
    this.showQuestion = true,
    required this.isLoggedIn,
    this.onCorrect,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showQuestion && job.question.isNotEmpty) ...[
          QuestionBubble(question: job.question),
          const SizedBox(height: 8),
        ],
        if (!job.isFinished) ...[
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: 8),
          const Center(child: Text('裁定を生成しています…')),
          const SizedBox(height: 8),
          const LoadingBannerAd(),
        ] else if (job.status == RulingJobStatus.failed)
          Text(
            job.error ?? '裁定生成中にエラーが発生しました。',
            style: const TextStyle(color: Colors.red),
          )
        else if (job.result != null) ...[
          RulingResultView(result: job.result!),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: () => shareRuling(job.question, job.result!),
                icon: const Icon(Icons.share_outlined, size: 18),
                label: const Text('共有'),
              ),
              if (isLoggedIn && onCorrect != null)
                OutlinedButton(
                  onPressed: onCorrect,
                  child: const Text('この裁定を訂正する'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
