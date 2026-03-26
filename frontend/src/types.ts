export interface Issue {
  type: string;
  severity: 'high' | 'medium' | 'low' | 'critical';
  section: string;
  isSystem?: boolean;
  message: string;
  suggestion: string;
  tag: string;
  text: string;
  code: string;
  category?: string;
  details?: any[];
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
    totalIssues: number;
    categoryCounts: Record<string, number>;
  };
  commonIssues?: {
    headerFooter: {
      label: string;
      issues: (Issue & { category?: string })[];
    };
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
