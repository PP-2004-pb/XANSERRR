import { Router } from "express";
import { z } from "zod";
import {
  AssetGroup,
  AssetCategory,
  Department,
  Location,
  Audit,
} from "./models.js";
import { staff, roles } from "./auth.js";
export const catalog = Router();
const entries = {
  groups: AssetGroup,
  categories: AssetCategory,
  departments: Department,
  locations: Location,
};
const body = {
  groups: z.object({
    prefix: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,8}$/),
    name: z.string().trim().min(1),
  }),
  categories: z.object({ name: z.string().trim().min(1) }),
  departments: z.object({ name: z.string().trim().min(1) }),
  locations: z.object({
    name: z.string().trim().min(1),
    building: z.string().trim().optional(),
    floor: z.string().trim().optional(),
    department: z.string().trim().optional(),
  }),
};
for (const [key, Model] of Object.entries(entries)) {
  catalog.get(`/${key}`, async (req, res) =>
    res.json(
      await Model.find(
        key === "departments" && req.user.role === "Department User"
          ? { name: req.user.department }
          : {},
      )
        .sort({ name: 1 })
        .lean(),
    ),
  );
  catalog.post(
    `/${key}`,
    key === "departments" || key === "locations" ? roles("Admin") : staff,
    async (req, res) => {
      const record = await Model.create(body[key].parse(req.body));
      await Audit.create({
        actor: req.user.name,
        action: `Create ${key}`,
        after: record.toObject(),
      });
      res.status(201).json(record);
    },
  );
}
