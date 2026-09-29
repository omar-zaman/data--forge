/**
 * VisualTemplateService
 * CRUD operations and validation for VisualTemplate model
 */

import prisma from "@/lib/db/prisma";
import type {
  VisualTemplate,
  VisualTemplateWithUser,
  CreateVisualTemplateInput,
  UpdateVisualTemplateInput,
  TemplateFilters,
  LayoutConfig,
  LayoutSection,
} from "@/types/database";

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new visual template.
 */
export async function createTemplate(
  data: CreateVisualTemplateInput
): Promise<VisualTemplate> {
  return prisma.visualTemplate.create({ data });
}

/**
 * Retrieve a single template by ID.
 * Returns null if not found.
 */
export async function getTemplate(
  id: string
): Promise<VisualTemplate | null> {
  return prisma.visualTemplate.findUnique({ where: { id } });
}

/**
 * Retrieve a template with its associated user relation.
 * Returns null if not found.
 */
export async function getTemplateWithUser(
  id: string
): Promise<VisualTemplateWithUser | null> {
  return prisma.visualTemplate.findUnique({
    where: { id },
    include: { user: true },
  });
}

/**
 * List templates with optional filters.
 * Supports filtering by userId, category, isPublic, and a text search over name.
 */
export async function listTemplates(
  filters: TemplateFilters = {}
): Promise<VisualTemplate[]> {
  const { userId, category, isPublic, search } = filters;

  return prisma.visualTemplate.findMany({
    where: {
      ...(userId !== undefined && { userId }),
      ...(category !== undefined && { category }),
      ...(isPublic !== undefined && { isPublic }),
      ...(search !== undefined && {
        name: { contains: search, mode: "insensitive" },
      }),
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Update an existing template by ID.
 * Throws if the template does not exist.
 */
export async function updateTemplate(
  id: string,
  data: UpdateVisualTemplateInput
): Promise<VisualTemplate> {
  return prisma.visualTemplate.update({ where: { id }, data });
}

/**
 * Delete a template by ID.
 * Throws if the template does not exist.
 */
export async function deleteTemplate(id: string): Promise<VisualTemplate> {
  return prisma.visualTemplate.delete({ where: { id } });
}

// ============================================
// Layout Config Validation
// ============================================

const VALID_PAGE_SIZES = ["A4", "LETTER", "LEGAL"] as const;
const VALID_ORIENTATIONS = ["portrait", "landscape"] as const;
const VALID_SECTION_TYPES = [
  "header",
  "body",
  "footer",
  "table",
  "chart",
  "text",
] as const;
const VALID_FONT_WEIGHTS = [
  "normal",
  "bold",
  "lighter",
  "bolder",
] as const;
const VALID_FONT_STYLES = ["normal", "italic", "oblique"] as const;

/**
 * Validate a LayoutConfig object structure.
 * Checks that all present fields have the expected shape and values.
 */
export function validateLayoutConfig(config: LayoutConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return { isValid: false, errors: ["layoutConfig must be an object"] };
  }

  // pageSize
  if (config.pageSize !== undefined) {
    if (!(VALID_PAGE_SIZES as readonly string[]).includes(config.pageSize)) {
      errors.push(
        `pageSize must be one of: ${VALID_PAGE_SIZES.join(", ")}`
      );
    }
  }

  // orientation
  if (config.orientation !== undefined) {
    if (
      !(VALID_ORIENTATIONS as readonly string[]).includes(config.orientation)
    ) {
      errors.push(
        `orientation must be one of: ${VALID_ORIENTATIONS.join(", ")}`
      );
    }
  }

  // margins
  if (config.margins !== undefined) {
    const { margins } = config;
    if (typeof margins !== "object" || margins === null) {
      errors.push("margins must be an object");
    } else {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        if (typeof margins[side] !== "number") {
          errors.push(`margins.${side} must be a number`);
        }
      }
    }
  }

  // sections
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections)) {
      errors.push("sections must be an array");
    } else {
      config.sections.forEach((section: LayoutSection, idx: number) => {
        const prefix = `sections[${idx}]`;

        if (!section.id || typeof section.id !== "string") {
          errors.push(`${prefix}.id must be a non-empty string`);
        }

        if (
          !(VALID_SECTION_TYPES as readonly string[]).includes(section.type)
        ) {
          errors.push(
            `${prefix}.type must be one of: ${VALID_SECTION_TYPES.join(", ")}`
          );
        }

        if (
          !section.position ||
          typeof section.position !== "object" ||
          Array.isArray(section.position)
        ) {
          errors.push(`${prefix}.position must be an object`);
        } else {
          for (const coord of ["x", "y", "width", "height"] as const) {
            if (typeof section.position[coord] !== "number") {
              errors.push(`${prefix}.position.${coord} must be a number`);
            }
          }
        }
      });
    }
  }

  // fonts
  if (config.fonts !== undefined) {
    if (!Array.isArray(config.fonts)) {
      errors.push("fonts must be an array");
    } else {
      config.fonts.forEach((font, idx) => {
        const prefix = `fonts[${idx}]`;

        if (!font.family || typeof font.family !== "string") {
          errors.push(`${prefix}.family must be a non-empty string`);
        }

        if (typeof font.size !== "number" || font.size <= 0) {
          errors.push(`${prefix}.size must be a positive number`);
        }

        if (
          font.weight !== undefined &&
          !(VALID_FONT_WEIGHTS as readonly string[]).includes(font.weight)
        ) {
          errors.push(
            `${prefix}.weight must be one of: ${VALID_FONT_WEIGHTS.join(", ")}`
          );
        }

        if (
          font.style !== undefined &&
          !(VALID_FONT_STYLES as readonly string[]).includes(font.style)
        ) {
          errors.push(
            `${prefix}.style must be one of: ${VALID_FONT_STYLES.join(", ")}`
          );
        }
      });
    }
  }

  // colors
  if (config.colors !== undefined) {
    if (
      typeof config.colors !== "object" ||
      config.colors === null ||
      Array.isArray(config.colors)
    ) {
      errors.push("colors must be an object");
    } else {
      const hexOrNamedColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-z]+$/;
      for (const key of [
        "primary",
        "secondary",
        "accent",
        "background",
        "text",
      ] as const) {
        const value = config.colors[key];
        if (value !== undefined && !hexOrNamedColor.test(value)) {
          errors.push(
            `colors.${key} must be a valid hex color (e.g. #fff or #ffffff) or a named color`
          );
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// Template Application
// ============================================

/**
 * Apply a visual template to the provided data.
 * Currently returns a stub string — full rendering engine integration is pending.
 *
 * @param templateId - ID of the VisualTemplate to apply
 * @param data - The data payload to render using the template
 * @returns A stub result string (future: rendered document URL or content)
 */
export async function applyTemplate(
  templateId: string,
  data: unknown
): Promise<string> {
  const template = await getTemplate(templateId);

  if (!template) {
    throw new Error(`Template with id "${templateId}" not found`);
  }

  // Stub implementation — full rendering engine integration is pending
  return `[STUB] Template "${template.name}" (id: ${template.id}) applied to data`;
}
