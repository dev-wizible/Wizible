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
        additionalProperties: false,
        properties: {
          basics: {
            additionalProperties: false,
            properties: {
              name: {
                description: "The full name of the candidate",
                type: "string"
              },
              email: {
                description: "The email address of the candidate",
                type: "string"
              },
              phone: {
                anyOf: [
                  {
                    type: "string"
                  },
                  {
                    type: "null"
                  }
                ],
                description: "The phone number of the candidate in any standard format"
              },
              location: {
                anyOf: [
                  {
                    additionalProperties: false,
                    properties: {
                      city: {
                        description: "The city where the candidate is located",
                        type: "string"
                      },
                      region: {
                        description: "State or province of the candidate",
                        type: "string"
                      },
                      country: {
                        description: "Country where the candidate is located",
                        type: "string"
                      }
                    },
                    required: [
                      "city",
                      "region",
                      "country"
                    ],
                    type: "object"
                  },
                  {
                    type: "null"
                  }
                ]
              },
              profiles: {
                anyOf: [
                  {
                    items: {
                      additionalProperties: false,
                      properties: {
                        network: {
                          description: "Name of the social network (e.g., LinkedIn, GitHub)",
                          type: "string"
                        },
                        url: {
                          description: "Full URL to the profile",
                          type: "string"
                        }
                      },
                      required: [
                        "network",
                        "url"
                      ],
                      type: "object"
                    },
                    type: "array"
                  },
                  {
                    type: "null"
                  }
                ]
              },
              summary: {
                anyOf: [
                  {
                    type: "string"
                  },
                  {
                    type: "null"
                  }
                ],
                description: "Brief professional summary or objective statement"
              }
            },
            required: [
              "name",
              "email",
              "phone",
              "location",
              "profiles",
              "summary"
            ],
            type: "object"
          },
          skills: {
            description: "Technical and professional skills grouped by category",
            items: {
              additionalProperties: false,
              properties: {
                category: {
                  description: "Skill category (e.g., Programming Languages, Tools, Soft Skills)",
                  type: "string"
                },
                keywords: {
                  description: "List of specific skills within the category",
                  items: {
                    type: "string"
                  },
                  type: "array"
                },
                level: {
                  anyOf: [
                    {
                      type: "string"
                    },
                    {
                      type: "null"
                    }
                  ],
                  description: "Proficiency level in this skill category"
                }
              },
              required: [
                "category",
                "keywords",
                "level"
              ],
              type: "object"
            },
            type: "array"
          },
          experience: {
            description: "Professional work experience in reverse chronological order",
            items: {
              additionalProperties: false,
              properties: {
                company: {
                  description: "Name of the employer or company",
                  type: "string"
                },
                position: {
                  description: "Job title or role",
                  type: "string"
                },
                startDate: {
                  description: "Start date of employment (YYYY-MM or YYYY-MM-DD)",
                  type: "string"
                },
                endDate: {
                  anyOf: [
                    {
                      type: "string"
                    },
                    {
                      type: "null"
                    }
                  ],
                  description: "End date of employment (YYYY-MM or YYYY-MM-DD), or 'Present' if current"
                },
                impact: {
                  anyOf: [
                    {
                      items: {
                        type: "string"
                      },
                      type: "array"
                    },
                    {
                      type: "null"
                    }
                  ],
                  description: "List of all the key impacts which the individual has contributed to in their tenure in this organization. Always mentioned in some numerical value."
                },
                responsibilties: {
                  description: "list of all the tasks and responsibilities they were looking at in a particular designation in that company",
                  type: "string"
                },
                "team management": {
                  description: "Candidate mentions the number of people and the type of people they have managed in that particular designation/role.",
                  type: "string"
                },
                "awards and recognitions": {
                  description: "awards and recognitions given by management or manager for performing great at work.",
                  type: "string"
                }
              },
              required: [
                "company",
                "position",
                "startDate",
                "endDate",
                "impact",
                "responsibilties",
                "team management",
                "awards and recognitions"
              ],
              type: "object"
            },
            type: "array"
          },
          education: {
            anyOf: [
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    institution: {
                      type: "string"
                    },
                    degree: {
                      type: "string"
                    },
                    field: {
                      anyOf: [
                        {
                          type: "string"
                        },
                        {
                          type: "null"
                        }
                      ]
                    },
                    graduationDate: {
                      anyOf: [
                        {
                          type: "string"
                        },
                        {
                          type: "null"
                        }
                      ]
                    },
                    gpa: {
                      anyOf: [
                        {
                          type: "number"
                        },
                        {
                          type: "null"
                        }
                      ]
                    }
                  },
                  required: [
                    "institution",
                    "degree",
                    "field",
                    "graduationDate",
                    "gpa"
                  ],
                  type: "object"
                },
                type: "array"
              },
              {
                type: "null"
              }
            ]
          },
          certifications: {
            anyOf: [
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    name: {
                      type: "string"
                    },
                    issuer: {
                      anyOf: [
                        {
                          type: "string"
                        },
                        {
                          type: "null"
                        }
                      ]
                    },
                    date: {
                      type: "string"
                    },
                    validUntil: {
                      anyOf: [
                        {
                          type: "string"
                        },
                        {
                          type: "null"
                        }
                      ]
                    }
                  },
                  required: [
                    "name",
                    "issuer",
                    "date",
                    "validUntil"
                  ],
                  type: "object"
                },
                type: "array"
              },
              {
                type: "null"
              }
            ]
          },
          publications: {
            anyOf: [
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    title: {
                      type: "string"
                    },
                    publisher: {
                      type: "string"
                    },
                    date: {
                      type: "string"
                    },
                    url: {
                      type: "string"
                    }
                  },
                  required: [
                    "title",
                    "publisher",
                    "date",
                    "url"
                  ],
                  type: "object"
                },
                type: "array"
              },
              {
                type: "null"
              }
            ]
          }
        },
        required: [
          "basics",
          "skills",
          "experience",
          "education",
          "certifications",
          "publications"
        ],
        type: "object"
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