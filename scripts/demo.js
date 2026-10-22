import { startCompanion } from '../lib/transport.js';
const state = { connected: true, demo: true, projects: [
  { id: 'demo-a', name: '示例项目 · 桌宠联调（演示）', status: 'working', detail: '正在运行测试', updatedAt: Date.now() },
  { id: 'demo-b', name: '示例项目 · 文档整理（演示）', status: 'thinking', detail: '思考中', updatedAt: Date.now() },
], approvals: [], notice: null };
const companion = await startCompanion({ getState: () => state, onDisconnect: () => { companion.close(); process.exit(); }, onDecision: ({id,decision}, reply) => {
  const approval = state.approvals.find(a => a.id === id);
  if (!approval) return reply({ok:false,error:'审批已失效'});
  state.approvals = state.approvals.filter(a => a.id !== id);
  state.projects[0].status = decision === 'allowed-once' ? 'completed' : 'aborted';
  state.projects[0].detail = decision === 'allowed-once' ? '演示任务已完成' : '演示操作已拒绝';
  state.notice = { id: String(Date.now()), kind: decision === 'allowed-once' ? 'completed' : 'aborted', title: '演示反馈', body: '本次仅测试界面，没有执行实际命令。' };
  reply({ok:true}); companion.send(state);
} });
setTimeout(() => { state.approvals = [{ id: 'demo-approval', projectId: 'demo-a', projectName: state.projects[0].name, tool: '演示工具', reason: '测试审批按钮是否可用，不会执行命令。', operation: '演示：运行项目测试' }]; state.projects[0].status = 'approval'; state.projects[0].detail = '等待批准（演示）'; companion.send(state); }, 5000);
process.on('SIGINT', () => { companion.close(); setTimeout(() => process.exit(), 300); });
console.log('桌宠演示已启动，按 Ctrl+C 退出。演示不会执行审批中的命令。');
