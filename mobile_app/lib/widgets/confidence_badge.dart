import 'package:flutter/material.dart';

class ConfidenceBadge extends StatelessWidget {
  final String confidence;

  const ConfidenceBadge({super.key, required this.confidence});

  // 「高」はアプリの基調色(トーク画面のグリーン)そのものに合わせ、
  // 「中/低」は警戒度を示す意味色として区別する(基調色とは独立させる)。
  Color _color(BuildContext context) {
    switch (confidence) {
      case 'high':
        return Theme.of(context).colorScheme.primary;
      case 'medium':
        return Colors.orange;
      default:
        return Colors.red;
    }
  }

  String _label() {
    switch (confidence) {
      case 'high':
        return '確信度: 高';
      case 'medium':
        return '確信度: 中';
      default:
        return '確信度: 低';
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color),
      ),
      child: Text(
        _label(),
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.bold,
          fontSize: 12,
        ),
      ),
    );
  }
}
