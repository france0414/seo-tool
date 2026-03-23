export interface Issue {
  type: string;
  severity: 'high' | 'medium' | 'low';
  section: string;
  isSystem?: boolean; // 新增：是否為系統結構
  message: string;
  suggestion: string;
  tag: string;
  text: string;
  code: string;
  deduction: number;
}

export interface Category {
  order: number;
  label: string;
  description?: string;
  issues: Issue[];
  count: number;
}

export interface ScanResult {
  success: boolean;
  url: string;
  score: number;
  totalIssues: number;
  categories: Record<string, Category>;
  sections: {
    header: string | null;
    footer: string | null;
    main: string | null;
  };
  error?: string;
}

export interface CrawlResult {
  success: boolean;
  mode: string;
  totalPages: number;
  summary: {
    avgScore: number;
    totalIssues: number;
    categoryCounts: Record<string, number>;
  };
  pages: ScanResult[];
  error?: string;
}

export interface DiscoveredMode {
  key: string;
  prefix: string;
  label: string;
  icon: string;
  count: number;
}

export type ScanMode = 'single' | 'pages' | 'product' | 'blog' | 'all' | string;
