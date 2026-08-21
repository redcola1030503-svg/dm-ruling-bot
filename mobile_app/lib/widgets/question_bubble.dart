import 'package:flutter/material.dart';

/// ユーザーの質問を、トーク画面の自分の発言のような右寄せ・緑色の
/// ふきだしとして表示する。RulingScreen・RulingTurnViewの両方から使う。
class QuestionBubble extends StatelessWidget {
  final String question;

  const QuestionBubble({super.key, required this.question});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: colorScheme.primary,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
              bottomLeft: Radius.circular(16),
              bottomRight: Radius.circular(4),
            ),
          ),
          child: SelectableText(
            question,
            style: TextStyle(color: colorScheme.onPrimary),
          ),
        ),
      ),
    );
  }
}
