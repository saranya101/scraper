export const workspaceNav = [
  { slug: "beauty-aesthetics", label: "Beauty & Aesthetics" },
  { slug: "dental", label: "Dental" },
  { slug: "medical-clinics", label: "Medical" },
  { slug: "interior-design", label: "Interior Design" },
  { slug: "home-services", label: "Home Services" },
  { slug: "restaurants", label: "Restaurants" },
  { slug: "legal", label: "Legal" },
  { slug: "custom", label: "Custom" }
];

export function workspaceLabel(slug, fallback = "Industry workspace") {
  return workspaceNav.find((item) => item.slug === slug)?.label || fallback;
}
