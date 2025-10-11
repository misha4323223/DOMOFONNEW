# Design Guidelines: Домофонная служба | ИП Бухтеев

## Design Approach
**Selected Approach:** Design System (Material Design inspired) + Landing Page Best Practices
**Justification:** Technical service company requiring professional trust, clear information hierarchy, and functional form integration. The utility-focused nature demands clarity over decoration.

## Core Design Elements

### A. Color Palette

**Light Mode:**
- Primary: 220 85% 45% (Deep professional blue - trust and technology)
- Primary Hover: 220 85% 38%
- Secondary: 210 20% 50% (Neutral blue-gray for supporting elements)
- Background: 0 0% 98% (Soft white)
- Surface: 0 0% 100% (Pure white for cards)
- Text Primary: 220 15% 20% (Deep charcoal)
- Text Secondary: 220 10% 45% (Muted gray)
- Accent/CTA: 145 70% 45% (Trustworthy green for success actions)
- Border: 220 15% 88%

**Dark Mode:**
- Primary: 220 75% 55%
- Primary Hover: 220 75% 62%
- Secondary: 210 15% 55%
- Background: 220 15% 12%
- Surface: 220 12% 16%
- Text Primary: 220 10% 95%
- Text Secondary: 220 8% 70%
- Accent/CTA: 145 60% 50%
- Border: 220 12% 25%

### B. Typography
- **Primary Font:** 'Manrope' or 'Inter' (Google Fonts) - clean, modern, professional
- **Headings:** 
  - H1: text-5xl font-bold (hero title)
  - H2: text-4xl font-bold (section titles)
  - H3: text-2xl font-semibold (subsections)
- **Body:** text-base leading-relaxed (16px, 1.75 line-height)
- **Small Text:** text-sm (form labels, footer info)

### C. Layout System
**Spacing Primitives:** Consistently use Tailwind units of **2, 4, 6, 8, 12, 16, 20, 24** for padding, margins, and gaps.
- Component padding: p-6 to p-8
- Section spacing: py-16 to py-24
- Card gaps: gap-6 to gap-8
- Button padding: px-6 py-3

**Container Structure:**
- Max width: max-w-6xl for content, max-w-7xl for wide sections
- Mobile-first responsive grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-3

### D. Component Library

**Hero Section:**
- Full-width with subtle gradient overlay
- Company name (H1) + tagline
- Primary CTA button "Оставить заявку" (Leave request)
- Clean, professional hero image of modern intercom systems or technician at work

**Services Section:**
- 2-column grid (Installation | Repair)
- Icon + Title + Description cards
- Subtle hover lift effect (translate-y-1)

**About Company Section:**
- Single column, centered text layout
- Trust indicators: years in business, service guarantees
- Contact information display

**Google Forms Integration Section:**
- Embedded iframe with smooth border-radius
- Contextual heading "Заявка на обслуживание"
- Supporting text about response time
- Alternative contact methods displayed alongside

**Footer:**
- 2-3 column layout: Company info | Quick links | Contact
- Social media icons (if applicable)
- Copyright and legal information

### E. Key Interactions
- Smooth scroll to form section on CTA click
- Subtle hover states on cards (shadow-lg transition)
- Form iframe loads with padding and rounded corners
- Mobile hamburger menu for navigation

## Images

**Hero Image:** 
Professional photograph of modern video intercom system mounted on building entrance, or technician installing doorphone equipment. Should convey technology, security, and professionalism. Placement: Full-width hero section with gradient overlay (from primary color at 60% opacity).

**Service Icons:**
Use Material Icons or Heroicons for service type indicators (installation icon, repair/wrench icon)

## Visual Hierarchy & Layout Strategy

**Single Page Structure (5-6 sections):**
1. **Hero** (80vh) - Immediate impact with company branding
2. **Services** (auto height) - 2-column feature showcase of installation/repair
3. **Benefits/Why Choose Us** (auto height) - 3-column grid of advantages
4. **Request Form** (auto height) - Embedded Google Forms with context
5. **Contact/Location Info** (auto height) - Map option or contact details
6. **Footer** (auto height) - Complete business information

**Vertical Rhythm:** py-16 on mobile, py-20 to py-24 on desktop for consistent section spacing

**Multi-Column Usage:**
- Services: 2 columns on desktop
- Benefits: 3 columns on lg, 2 on md, 1 on mobile
- Footer: 3 columns on desktop, stack on mobile

## Accessibility & Responsive Design
- Dark mode toggle in header (consistent implementation across all elements including form context)
- Mobile-first approach with touch-friendly buttons (min 44px tap targets)
- Clear focus states for keyboard navigation
- Semantic HTML structure for screen readers
- Русский язык throughout all content

## Professional Polish
- Subtle shadows for depth (shadow-md, shadow-lg)
- Consistent 8px border-radius for modern feel
- Smooth transitions (transition-all duration-300)
- Professional photography over illustrations for technical credibility
- Clear visual separation between sections with background alternation (white/light gray)