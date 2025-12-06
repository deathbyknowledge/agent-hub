# AgentHub
AgentHub is the next step of agentic software. It abstracts the agentic runtime so developers don't have to think about LLM providers, tool calling loops, or deployments at all.  
Instead, they can focus on what matters: the prompts, the tools and the orchestration. If you're fancy you might call it "context management", but really, that's what agents are.

It's entirely built on Cloudflare's Worker's platform (using the [Agents SDK](https://github.com/cloudflare/agents))!, allowing 1-click deployments. 

It follows this architecture:
- **AgentCloud**: The serverless runtime where each Agent has its own compute and storage. Each AgentCloud is multi-tenant, by using the concept of **Agencies**. An **Agency** holds the configuration for all Agents in it, and those Agents can communicate with each other. It exposes an HTTP API ready to use.
- **AgentHub Client**: An HTTP/WS client you can use from any application to use and manage your Agencies and Agents. It's up to you and how you architecture your applications to decide how to use it. I show some examples below.
- **AgentHub UI**: A web UI where you can access and manage all the features of your Agencies and Agents. It's a static application that uses the **AgentCloud** HTTP API. You might want to write your own UI or not use any at all! It all depends on _how_ you're using your agents.

