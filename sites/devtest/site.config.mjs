// devtest — the framework's staging site. Every framework change is proven
// here (GitHub Pages preview + Cloudflare devtest.zagware.io) before customer
// sites bump their framework version. Keep it exercising EVERY feature:
//   /                 informational home page (car_website / ardleevan style)
//   /components/      auto-generated catalogue: every section type's `example`
//   /shop/ …          stripe-lite commerce in Stripe TEST mode
import { loadComponents } from "../../src/index.mjs";

const COMMERCE_TYPES = new Set(["products", "cart", "checkout-status"]);
const registry = await loadComponents(new URL(".", import.meta.url).pathname);
const tones = ["default", "alt"];
const catalogueSections = [...registry.values()]
  .filter((c) => !COMMERCE_TYPES.has(c.type))
  .sort((a, b) => a.type.localeCompare(b.type))
  .map((c, i) => ({ ...c.example, type: c.type, id: `c-${c.type}`, tone: c.example?.tone ?? tones[i % 2] }));

export default {
  name: "Zagware Devtest",
  slug: "devtest",
  tagline: "Staging site for the Zagware website framework",
  description: "Staging and test site for the Zagware website framework: every component, both deploy targets, and Stripe test-mode checkout.",
  lang: "en-GB",
  urls: {
    production: "https://devtest.zagware.io/",
    pages: "https://zagware.github.io/website-framework/",
  },
  logo: { src: "img/logo.svg", width: 40, height: 40 },
  theme: { preset: "classic" },
  nav: [
    { label: "About", href: "/#about" },
    { label: "Gallery", href: "/#gallery" },
    { label: "FAQ", href: "/#faq" },
    { label: "Components", href: "/components/" },
    { label: "Shop", href: "/shop/" },
  ],
  navCta: { label: "Contact", href: "/#contact" },
  socials: [
    { network: "instagram", href: "https://www.instagram.com/" },
    { network: "facebook", href: "https://www.facebook.com/" },
  ],
  footer: {
    text: "Every framework feature ships here first. Test cards only — nothing is charged.",
    links: [
      { label: "Components", href: "/components/" },
      { label: "Shop", href: "/shop/" },
      { label: "Basket", href: "/shop/cart/" },
    ],
    sponsors: [
      { name: "Cloudflare", href: "https://www.cloudflare.com/" },
      { name: "Stripe", href: "https://stripe.com/" },
      { name: "GitHub", href: "https://github.com/" },
    ],
  },
  seo: {
    ogImage: "img/sample-1.jpg",
    organization: { email: "hello@zagware.io" },
  },
  redirects: [{ from: "/store/*", to: "/shop/", status: 301 }],
  // Site Worker (/api/checkout, /api/contact). "" = same origin on Cloudflare.
  api: { base: "" },

  commerce: {
    provider: "stripe-lite",
    currency: "GBP",
    locale: "en-GB",
    mode: "test",
    cartPath: "/shop/cart/",
    successPath: "/shop/success/",
    cancelPath: "/shop/cart/",
    shipping: {
      countries: ["GB", "IE"],
      rates: [
        { id: "standard", label: "Standard delivery (3–5 days)", amount: 395, freeOver: 5000 },
        { id: "express", label: "Express delivery (next day)", amount: 895 },
      ],
    },
    products: [
      {
        id: "devtest-tee",
        name: "Devtest T-shirt",
        description: "Heavyweight organic cotton tee. Exercises the option selector.",
        price: 2499,
        image: "img/product-1.jpg",
        options: [
          { name: "Size", values: ["S", "M", "L", "XL"] },
          { name: "Colour", values: ["Navy", "Stone"] },
        ],
        shippable: true,
        tags: ["apparel"],
      },
      {
        id: "devtest-mug",
        name: "Enamel mug",
        description: "Camp mug with a rolled rim. No options.",
        price: 1200,
        image: "img/product-2.jpg",
        shippable: true,
        tags: ["home"],
      },
      {
        id: "devtest-poster",
        name: "A2 route poster",
        description: "Giclée print of the long-course route map.",
        price: 3000,
        image: "img/product-3.jpg",
        shippable: true,
        tags: ["home", "print"],
      },
    ],
  },

  // Per-target overrides (deep-merged into the config above).
  targets: {
    // GitHub Pages cannot run the Worker, so previews call the devtest worker cross-origin.
    pages: { api: { base: "https://devtest.zagware.io" } },
    local: { api: { base: "http://localhost:8788" } },
  },

  pages: [
    {
      path: "/",
      title: "Zagware Devtest — framework staging site",
      sections: [
        {
          type: "hero",
          height: "full",
          eyebrow: "Staging · devtest",
          title: "Every feature, *tested* before it ships",
          lede: "This site exercises the whole Zagware website framework. If it works here on GitHub Pages and Cloudflare, it's ready for customer sites.",
          badge: "Framework v0.1",
          image: "img/sample-1.jpg",
          imageAlt: "",
          video: { src: "video/sample.mp4", poster: "video/sample-poster.jpg" },
          actions: [
            { label: "Browse components", href: "/components/", style: "accent" },
            { label: "Try the shop", href: "/shop/", style: "outline" },
          ],
          aside: { image: "img/portrait-1.jpg", caption: "Aside card", alt: "Sample portrait" },
        },
        {
          type: "strip",
          tone: "dark",
          items: [
            { icon: "map-pin", text: "Carlingford, Co. Louth", href: "https://maps.google.com/?q=Carlingford" },
            { icon: "bike", text: "Informational sites" },
            { icon: "cart", text: "Stripe checkout" },
            { icon: "shield", text: "Cloudflare hosting" },
          ],
        },
        {
          type: "split",
          id: "about",
          eyebrow: "About",
          heading: "One framework, *many* customer sites",
          paragraphs: [
            "Customer sites are a `site.config.mjs` plus images. The framework renders them to static HTML with SEO, sitemaps, responsive images and a hashed CSS/JS bundle.",
            "Previews go to **GitHub Pages** (noindex, preview banner). When a customer buys, the same build deploys to **Cloudflare** on their domain.",
          ],
          facts: [
            { label: "Preview", value: "GitHub Pages", sub: "Free, noindex" },
            { label: "Production", value: "Cloudflare", sub: "Workers static assets" },
            { label: "Checkout", value: "Stripe", sub: "Hosted Checkout, test mode here" },
          ],
          actions: [{ label: "See every component", href: "/components/" }],
        },
        {
          type: "cards",
          tone: "alt",
          eyebrow: "Tiers",
          heading: "What we can build",
          items: [
            { icon: "leaf", title: "Brochure site", text: "Informational, fast, hosted for pennies.", meta: "Static" },
            { icon: "cart", title: "Small shop", text: "Up to ~100 products with Stripe Checkout and a tiny Worker.", meta: "stripe-lite", href: "/shop/", linkLabel: "Try it" },
            { icon: "truck", title: "Full commerce", text: "Inventory, promotions and staff admin with Medusa.", meta: "Medusa (evaluated)" },
          ],
        },
        {
          type: "gallery",
          id: "gallery",
          eyebrow: "Gallery",
          heading: "Responsive images with a lightbox",
          images: [
            { src: "img/sample-2.jpg", alt: "Forest trail sample", caption: "Forest trail", wide: true },
            { src: "img/sample-3.jpg", alt: "Sunset ridge sample", caption: "Sunset ridge" },
            { src: "img/sample-4.jpg", alt: "Mountain pass sample", caption: "Mountain pass" },
            { src: "img/sample-5.jpg", alt: "Harbour lights sample", caption: "Harbour lights" },
            { src: "img/sample-6.jpg", alt: "Green valley sample", caption: "Green valley" },
          ],
        },
        {
          type: "videos",
          tone: "dark",
          eyebrow: "Video",
          heading: "Video players and lazy clips",
          videos: [
            { src: "video/sample.mp4", poster: "video/sample-poster.jpg", title: "Test pattern" },
            { src: "video/sample.mp4", poster: "video/sample-poster.jpg", title: "Test pattern (again)" },
          ],
          clips: [{ src: "video/sample.mp4" }, { src: "video/sample.mp4" }, { src: "video/sample.mp4" }],
        },
        { ...registry.get("faq").example, type: "faq", id: "faq" },
        {
          type: "cta",
          tone: "primary",
          heading: "Ready to see your own site here?",
          text: "We'll build a preview on GitHub Pages first — no commitment.",
          actions: [{ label: "Get in touch", href: "/#contact", style: "accent" }],
        },
        {
          type: "contact",
          id: "contact",
          eyebrow: "Contact",
          heading: "Talk to us",
          methods: [
            { kind: "email", label: "hello@zagware.io", href: "mailto:hello@zagware.io" },
            { kind: "whatsapp", label: "WhatsApp", href: "https://wa.me/440000000000" },
          ],
          form: {
            action: "worker",
            fields: [
              { name: "name", label: "Name", type: "text", required: true },
              { name: "email", label: "Email", type: "email", required: true },
              { name: "message", label: "Message", type: "textarea", required: true },
            ],
            submitLabel: "Send message",
          },
        },
      ],
    },
    {
      path: "/components/",
      title: "Component catalogue",
      description: "Every section type in the Zagware website framework rendered from its example props.",
      sections: [
        {
          type: "rich-text",
          heading: "Component catalogue",
          eyebrow: "Generated",
          body: "Each section below is rendered from the `example` props exported by its component. New components appear here automatically — check them on both targets before release.",
        },
        ...catalogueSections,
      ],
    },
    {
      path: "/shop/",
      title: "Shop",
      description: "Stripe test-mode shop for the Zagware website framework.",
      sections: [
        {
          type: "products",
          eyebrow: "Shop",
          heading: "Test-mode products",
          intro: "Use card `4242 4242 4242 4242`, any future expiry and any CVC. Nothing is charged.",
        },
      ],
    },
    {
      path: "/shop/cart/",
      title: "Basket",
      noindex: true,
      sections: [{ type: "cart", heading: "Your basket" }],
    },
    {
      path: "/shop/success/",
      title: "Order confirmed",
      noindex: true,
      sections: [
        {
          type: "checkout-status",
          status: "success",
          heading: "Thanks — order received",
          body: "This was a test-mode order. Check the Stripe dashboard (test mode) to see it.",
        },
      ],
    },
  ],
};
