# AgentHub
AgentHub is the next step of agentic software. It abstracts the agentic runtime so developers don't have to think about LLM providers, tool calling loops, or deployments at all.  
Instead, they can focus on what matters: the prompts, the tools and the orchestration. If you're fancy you might call it "context management", but really, that's what agents are.

It's entirely built on Cloudflare's Worker's platform (using the [Agents SDK](https://github.com/cloudflare/agents))!, allowing 1-click deployments. 

It follows this architecture:
- **AgentHub Runtime**: The serverless runtime where each Agent has its own [compute and storage](https://developers.cloudflare.com/agents/concepts/agent-class/#what-is-the-agent). Each AgentCloud is multi-tenant, by using the concept of **Agencies**. An **Agency** holds the configuration for all Agents in it, and those Agents can communicate with each other. It exposes an HTTP API ready to use.
- **AgentHub Client**: An HTTP/WS client you can use from any application to use and manage your Agencies and Agents. It's up to you and how you architecture your applications to decide how to use it. I show some examples below.
- **AgentHub UI**: A web UI where you can access and manage all the features of your Agencies and Agents. It's a static application that uses the **Runtime** HTTP API. You might want to write your own UI or not use any at all! It all depends on _how_ you're using your agents.

## Getting started
The base implementation includes a few tools, blueprints and plugins but you can edit or remove any of them and add the ones you like. To get up and running:
```sh
npm i
npm run dev
```

This will spin up a vite server with the runtime and UI. As you add new files or update the existing in `hub/tools`, `hub/blueprints`, or `hub/plugins`, the changes will be picked up automatically.

Set `LLM_API_KEY` and `LLM_API_BASE` in `.dev.vars` for global provider keys or set the same variables in your Agency settings page to override them for a given Agency you create.


## Concepts
There are three main concepts:
1. Tools
2. Blueprints
3. Plugins

### Tools
Tools are just the function definitions that you want your agents to be able to use. We have a very similar API to the [AI SDK](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool) so it should be straightforward to re-use any of your existing tools.  
The one difference is that we include an extra parameter in the tool callback, a `context` object. This context includes the `agent` instance, which has access to an R2-backed file system, agency/agent level variables, etc. Have a look at our example tools in `hub/tools` to see how to use it.

Mind you, the tools will **not** be added to all your agents, only those that specifically register them in their _blueprint_. Perfect segue.

### Blueprint
Blueprints are just a JSON definition for an agent template. You can define the prompt, model, register tools and plugins, etc. Then, you can create agent conversations using a blueprint which will inherit all its configuration.

Since they are _just_ JSON, they are completely serializable, meaning you can add/edit them at runtime without having to re-deploy your runtime. Very easy to iterate.

### Plugins
Plugins are an evolution from LangChain's [middleware](https://reference.langchain.com/python/langchain/middleware/) concept. They allow for very fine-grained context management while also providing flexibility for extending your runtime's capabilities.

You can take a look at the plugins in `hub/plugins` to see examples of how to build your own. I recommend `subagents` and `fs`.

