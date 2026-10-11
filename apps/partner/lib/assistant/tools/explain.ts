import { getKnowledgeTopic, knowledgeTopicIds } from '../knowledge'
import { defineTool } from './helpers'

export function explainFeatureTool() {
  return defineTool({
    name: 'explain_feature',
    label: 'Looking up how it works',
    description:
      'Accurate how-to text for a part of the partner portal (inventory map editor, schematic editor, each site tab), written from the real UI. Call it before explaining how to do something in the UI. Topic ids are listed in the system prompt.',
    properties: { topic: { type: 'string', enum: knowledgeTopicIds() } },
    required: ['topic'],
    run(input) {
      const topic = getKnowledgeTopic(String(input.topic))
      if (!topic) return { ok: false, error: 'unknown_topic' }
      return { topic: topic.id, title: topic.title, text: topic.body }
    },
  })
}
