class Judge {
  final String id;
  final String role;
  final int createdAt;
  final String? createdBy;

  const Judge({
    required this.id,
    required this.role,
    required this.createdAt,
    this.createdBy,
  });

  factory Judge.fromJson(Map<String, dynamic> json) {
    return Judge(
      id: json['id'] as String,
      role: json['role'] as String,
      createdAt: json['createdAt'] as int,
      createdBy: json['createdBy'] as String?,
    );
  }
}
