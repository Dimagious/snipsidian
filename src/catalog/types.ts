export type PackageItem = {
  id: string;
  label: string;
  kind: "builtin" | "community";
  yaml: string;
  // Community package metadata
  author?: string;
  version?: string;
  description?: string;
  category?: string;
  tags?: string[];
  license?: string;
  homepage?: string;
  rating?: number;
  downloads?: number;
  lastUpdated?: string;
  verified?: boolean;
  status?: "approved" | "pending" | "rejected";
};
