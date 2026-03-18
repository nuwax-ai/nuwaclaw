#!/usr/bin/env python3
"""
NuwaClaw GUI Agent - OSWorld Benchmark 测试
基于 OSWorld 标准的简化测试
"""

import sys
import time
import json
from typing import List, Dict, Any

sys.path.insert(0, '/Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent')

from hybrid_agent import HybridGUIAgent, Action, ActionType

# ========== 测试用例（基于 OSWorld 标准）==========

TEST_CASES = [
    {
        "id": "test_001",
        "task": "点击桌面左上角",
        "actions": [
            {"action_type": "MOVE_TO", "parameters": {"x": 50, "y": 50}},
            {"action_type": "CLICK", "parameters": {"button": "left"}}
        ],
        "expected": 2
    },
    {
        "id": "test_002",
        "task": "输入文本",
        "actions": [
            {"action_type": "TYPING", "parameters": {"text": "Hello NuwaClaw"}}
        ],
        "expected": 1
    },
    {
        "id": "test_003",
        "task": "键盘操作",
        "actions": [
            {"action_type": "PRESS", "parameters": {"key": "enter"}}
        ],
        "expected": 1
    }
]

# ========== Benchmark 运行器 ==========

class OSWorldBenchmark:
    def __init__(self):
        self.agent = HybridGUIAgent()
        self.results: List[Dict[str, Any]] = []
    
    def run_test(self, test_case: Dict[str, Any]) -> Dict[str, Any]:
        """运行单个测试用例"""
        print(f"\n📝 测试: {test_case['task']}")
        print("-" * 40)
        
        actions = [
            Action(
                action_type=ActionType[a["action_type"]],
                parameters=a["parameters"]
            )
            for a in test_case["actions"]
        ]
        
        start_time = time.time()
        
        # 执行操作
        success_count = 0
        total_count = len(actions)
        
        for i, action in enumerate(actions):
            result = self.agent.execute(action)
            
            if not result.isError:
                success_count += 1
                print(f"  ✅ 操作 {i+1}/{total_count}: {action.action_type.value}")
            else:
                print(f"  ❌ 操作 {i+1}/{total_count}: {action.action_type.value} - {result.content[0]['text']}")
        
        end_time = time.time()
        duration = end_time - start_time
        success_rate = success_count / total_count
        
        result = {
            "id": test_case['id'],
            "task": test_case['task'],
            "total_actions": total_count,
            "successful_actions": success_count,
            "success_rate": success_rate,
            "duration_seconds": duration,
            "expected": test_case['expected'],
            "passed": success_rate >= 0.5
        }
        
        self.results.append(result)
        
        print(f"\n结果:")
        print(f"  成功率: {success_rate:.1%} ({success_count}/{total_count})")
        print(f"  耗时: {duration:.2f}秒")
        print(f"  状态: {'✅ 通过' if result['passed'] else '❌ 失败'}")
        
        return result
    
    def run_all_tests(self):
        """运行所有测试"""
        print("=" * 60)
        print("NuwaClaw GUI Agent - OSWorld Benchmark")
        print("=" * 60)
        
        passed_tests = 0
        total_tests = len(TEST_CASES)
        
        for test_case in TEST_CASES:
            result = self.run_test(test_case)
            if result['passed']:
                passed_tests += 1
        
        self.generate_report(total_tests, passed_tests)
    
    def generate_report(self, total_tests: int, passed_tests: int):
        """生成测试报告"""
        print("\n" + "=" * 60)
        print("OSWorld Benchmark 测试报告")
        print("=" * 60)
        
        total_actions = sum(r['total_actions'] for r in self.results)
        successful_actions = sum(r['successful_actions'] for r in self.results)
        total_duration = sum(r['duration_seconds'] for r in self.results)
        
        print(f"\n📊 测试统计:")
        print(f"  测试用例: {passed_tests}/{total_tests} 通过")
        print(f"  操作总数: {successful_actions}/{total_actions} 成功")
        print(f"  总耗时: {total_duration:.2f}秒")
        print(f"  平均耗时: {total_duration/total_tests:.2f}秒/用例")
        
        print(f"\n📋 详细结果:")
        for r in self.results:
            status = "✅" if r['passed'] else "❌"
            print(f"  {status} {r['task']}: {r['success_rate']:.0%} ({r['duration_seconds']:.2f}s)")
        
        # 保存 JSON 报告
        report = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "summary": {
                "total_tests": total_tests,
                "passed_tests": passed_tests,
                "pass_rate": passed_tests / total_tests,
                "total_actions": total_actions,
                "successful_actions": successful_actions,
                "action_success_rate": successful_actions / total_actions,
                "total_duration_seconds": total_duration
            },
            "results": self.results
        }
        
        report_path = "/tmp/osworld_benchmark_report.json"
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        
        print(f"\n📄 报告已保存: {report_path}")

# ========== 主函数 ==========

if __name__ == "__main__":
    benchmark = OSWorldBenchmark()
    benchmark.run_all_tests()
