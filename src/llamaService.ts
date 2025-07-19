// src/LlamaService.ts
import axios from "axios";
import fs from "fs";
import FormData from "form-data";

export class LlamaService {
  private readonly API_BASE = "https://api.cloud.llamaindex.ai/api/v1";
  private readonly API_KEY: string;

  constructor(apiKey: string) {
    this.API_KEY = apiKey;
  }

  async getOrCreateAgent() {
    const agentName = "resume_parser_ts";
    try {
      const existing = await axios.get(
        `${this.API_BASE}/extraction/extraction-agents/by-name/${agentName}`,
        {
          headers: { Authorization: `Bearer ${this.API_KEY}` },
        }
      );
      return existing.data;
    } catch (err: any) {
      if (err.response?.status !== 404) throw err;
    }

    const schema = {
      name: agentName,
      data_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Candidate's full name" },
          email: { type: "string", description: "Email address" },
          phone: { type: "string", description: "Phone number" },
          location: {
            type: "string",
            description: "Location of the candidate",
          },
          linkedin: { type: "string", description: "LinkedIn profile URL" },
          github: { type: "string", description: "GitHub profile URL" },
          summary: {
            type: "string",
            description: "Professional summary or objective",
          },
          education: {
            type: "array",
            description: "Educational qualifications",
            items: {
              type: "object",
              properties: {
                degree: { type: "string", description: "Degree name" },
                institution: {
                  type: "string",
                  description: "College/University",
                },
                location: {
                  type: "string",
                  description: "Institution location",
                },
                gpa: { type: "string", description: "Grade/GPA" },
                dates: {
                  type: "string",
                  description: "Duration of the course",
                },
              },
            },
          },
          experience: {
            type: "array",
            description: "Professional work experience",
            items: {
              type: "object",
              properties: {
                company: { type: "string", description: "Company name" },
                title: { type: "string", description: "Role or position held" },
                location: { type: "string", description: "Work location" },
                dates: { type: "string", description: "Employment duration" },
                responsibilities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key responsibilities and achievements",
                },
              },
            },
          },
          projects: {
            type: "array",
            description: "Major projects built or contributed to",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Project name" },
                tech_stack: {
                  type: "string",
                  description: "Technologies used",
                },
                description: {
                  type: "array",
                  items: { type: "string" },
                  description: "Project highlights",
                },
              },
            },
          },
          awards: {
            type: "array",
            items: { type: "string" },
            description: "Awards and leadership experiences",
          },
          skills: {
            type: "array",
            description: "Technical and core skills",
            items: { type: "string" },
          },
        },
      },
      config: {
        extraction_target: "PER_DOC",
        extraction_mode: "BALANCED",
      },
    };

    const res = await axios.post(
      `${this.API_BASE}/extraction/extraction-agents`,
      schema,
      {
        headers: {
          Authorization: `Bearer ${this.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data;
  }

  async uploadFile(filePath: string) {
    const form = new FormData();
    form.append("upload_file", fs.createReadStream(filePath));
    const res = await axios.post(`${this.API_BASE}/files`, form, {
      headers: {
        Authorization: `Bearer ${this.API_KEY}`,
        ...form.getHeaders(),
      },
    });
    return res.data;
  }

  async runExtraction(agentId: string, fileId: string) {
    const res = await axios.post(
      `${this.API_BASE}/extraction/jobs`,
      {
        extraction_agent_id: agentId,
        file_id: fileId,
      },
      {
        headers: {
          Authorization: `Bearer ${this.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data;
  }

  async pollJob(jobId: string) {
    let status = "PENDING";
    let attempt = 0;

    while (status !== "SUCCESS" && attempt < 10) {
      const res = await axios.get(`${this.API_BASE}/extraction/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${this.API_KEY}` },
      });
      status = res.data.status;
      if (status === "SUCCESS") return res.data;
      if (status === "FAILED") throw new Error("Extraction failed");
      await new Promise((r) => setTimeout(r, 3000));
      attempt++;
    }
    throw new Error("Extraction timeout");
  }

  async getResult(jobId: string) {
    const res = await axios.get(
      `${this.API_BASE}/extraction/jobs/${jobId}/result`,
      {
        headers: { Authorization: `Bearer ${this.API_KEY}` },
      }
    );
    return res.data;
  }
}
