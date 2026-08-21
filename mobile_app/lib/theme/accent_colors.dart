import 'package:flutter/material.dart';

class AccentColorOption {
  final String name;
  final Color color;

  const AccentColorOption(this.name, this.color);
}

const List<AccentColorOption> kAccentColorOptions = [
  AccentColorOption('現行(自然文明グリーン)', Color(0xFF4CAF78)),
  AccentColorOption('水文明ブルー', Color(0xFF2F80ED)),
  AccentColorOption('火文明レッド', Color(0xFFE5484D)),
  AccentColorOption('光文明ゴールド', Color(0xFFC99A2E)),
  AccentColorOption('闇文明パープル', Color(0xFF6B4E9B)),
  AccentColorOption('旧ブランド藍', Color(0xFF3034D4)),
  AccentColorOption('ティール', Color(0xFF16A3A3)),
  AccentColorOption('スレートインディゴ', Color(0xFF4B5AAE)),
  AccentColorOption('コーラルピンク', Color(0xFFF0637C)),
  AccentColorOption('モノトーン(グレー基調)', Color(0xFF37474F)),
];
