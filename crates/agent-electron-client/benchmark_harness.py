#!/usr/bin/env python3
"""
Harness Benchmark v2 - Deep Research Edition
=========================================
Measures ACTUAL harness effectiveness with comprehensive metrics.

Usage: python3 benchmark.py --project /path/to/project [--baseline /path/baseline] [--output json|markdown]
"""

import argparse
import json
import os
import sys
import subprocess
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple


@dataclass
class Metric:
    name: str
    value: float
    weight: float
    direction: str  # "higher" or "lower"
    unit: str = "%"
    
    def normalized(self) -> float:
        if self.direction == "higher":
            return min(100, max(0, self.value))
        else:
            return min(100, max(0, 100 - self.value))


@dataclass
class BenchmarkResult:
    efficiency: Dict[str, float]
    quality: Dict[str, float]
    behavior: Dict[str, float]
    autonomy: Dict[str, float]
    overall: float
    grade: str
    grade_desc: str
    timestamp: str
    recommendations: List[str]
    historical: List[Dict] = field(default_factory=list)
    

class HarnessBenchmark:
    """Comprehensive harness effectiveness benchmark."""
    
    def __init__(self, project_path: str, baseline_path: Optional[str] = None):
        self.project_path = project_path
        self.baseline_path = baseline_path or project_path
        self.metrics: List[Metric] = []
        self.total_weight = 0
        self.efficiency_data = {}
        self.quality_data = {}
        self.behavior_data = {}
        self.autonomy_data = {}
        self.recommendations = []
        
    # ====================
    # DATA COLLECTION
    # ====================
    
    def load_state(self) -> Dict:
        """Load harness state."""
        state_file = os.path.join(self.project_path, "harness/feedback/state/state.json")
        if os.path.exists(state_file):
            with open(state_file) as f:
                return json.load(f)
        return {}
    
    def load_baseline(self) -> Dict:
        """Load baseline for comparison."""
        if self.baseline_path == self.project_path:
            return self.load_state()
        baseline_file = os.path.join(self.baseline_path, "harness/feedback/state/state.json")
        if os.path.exists(baseline_file):
            with open(baseline_file) as f:
                return json.load(f)
        return {}
    
    def find_source_files(self) -> str:
        """Find source code directory."""
        for d in ["src", "app", "lib", "source"]:
            path = os.path.join(self.project_path, d)
            if os.path.exists(path):
                return path
        return self.project_path
    
    def count_pattern(self, pattern: str, src_dir: str) -> int:
        """Count pattern occurrences in source."""
        try:
            result = subprocess.run(
                ["grep", "-r", "-l", pattern, src_dir,
                 "--include=*.ts", "--include=*.tsx",
                 "--include=*.js", "--include=*.jsx",
                 "--include=*.py", "--include=*.go"],
                capture_output=True, text=True, timeout=30
            )
            return len([l for l in result.stdout.strip().split("\n") if l])
        except:
            return 0
    
    # ====================
    # EFFICIENCY METRICS (40%)
    # ====================
    
    def measure_efficiency(self) -> Dict[str, float]:
        print("=" * 60)
        print("1. EFFICIENCY (40%)")
        print("-" * 50)
        
        state = self.load_state()
        baseline = self.load_baseline()
        
        metrics = state.get("metrics", {})
        baseline_metrics = baseline.get("metrics", {})
        
        # Task Completion Rate
        completed = metrics.get("tasksCompleted", 0)
        blocked = metrics.get("tasksBlocked", 0)
        total_tasks = completed + blocked
        
        if total_tasks > 0:
            completion_rate = (completed / total_tasks) * 100
            block_rate = (blocked / total_tasks) * 100
        else:
            completion_rate = 100  # New project
            block_rate = 0
        
        print(f"   Tasks Completed:  {completed}")
        print(f"   Tasks Blocked:    {blocked}")
        print(f"   Completion Rate: {completion_rate:.1f}%")
        print(f"   Block Rate:      {block_rate:.1f}%")
        
        # Gate Pass Rate
        gates = state.get("gates", {})
        gates_passed = sum(1 for v in gates.values() if v == "passed")
        gates_failed = sum(1 for v in gates.values() if v == "failed")
        total_gates = len(gates) or 4
        
        gate_pass_rate = (gates_passed / total_gates) * 100 if total_gates > 0 else 0
        gate_fail_rate = (gates_failed / total_gates) * 100 if total_gates > 0 else 0
        
        print(f"   Gate Pass Rate:   {gate_pass_rate:.1f}%")
        print(f"   Gate Fail Rate:  {gate_fail_rate:.1f}%")
        
        # Average Task Duration (simulated - would need historical data)
        avg_duration = metrics.get("averageTaskDuration", 0)
        baseline_duration = baseline_metrics.get("averageTaskDuration", 0)
        
        if avg_duration > 0 and baseline_duration > 0:
            duration_change = ((avg_duration - baseline_duration) / baseline_duration) * 100
        else:
            duration_change = 0
        
        print(f"   Avg Duration:    {avg_duration:.0f} min")
        print(f"   Duration Δ:      {duration_change:+.1f}%")
        
        # First-try Pass Rate (how often gate passes first time)
        first_try_rate = ((total_gates - gates_failed) / total_gates * 100) if total_gates > 0 else 100
        print(f"   First-Try Rate:  {first_try_rate:.1f}%")
        
        # Throughput (tasks per day)
        last_reset = metrics.get("lastReset", None)
        if last_reset:
            try:
                reset_date = datetime.fromisoformat(last_reset)
                days_since_reset = (datetime.now() - reset_date).days or 1
                throughput = completed / days_since_reset
            except:
                throughput = 0
        else:
            throughput = completed
        print(f"   Throughput:      {throughput:.2f} tasks/day")
        
        self.efficiency_data = {
            "completion_rate": completion_rate,
            "block_rate": block_rate,
            "gate_pass_rate": gate_pass_rate,
            "first_try_rate": first_try_rate,
            "duration_change": duration_change,
            "throughput": throughput
        }
        
        return self.efficiency_data
    
    # ====================
    # QUALITY METRICS (30%)
    # ====================
    
    def measure_quality(self) -> Dict[str, float]:
        print()
        print("2. QUALITY (30%)")
        print("-" * 50)
        
        src_dir = self.find_source_files()
        
        # Code Issues
        console_logs = self.count_pattern("console.log", src_dir)
        debuggers = self.count_pattern("debugger", src_dir)
        
        # Normalize: each issue penalizes score
        quality_base = max(0, 100 - (console_logs * 2) - (debuggers * 5))
        
        print(f"   console.log:     {console_logs}")
        print(f"   debugger:       {debuggers}")
        print(f"   Quality Score:  {quality_base:.1f}")
        
        # Type Check Pass Rate
        state = self.load_state()
        gates = state.get("gates", {})
        type_pass = 1 if gates.get("typecheck") == "passed" else 0
        type_rate = type_pass * 100
        print(f"   Type Check:      {'PASS' if type_pass else 'FAIL'}")
        
        # Test Coverage (would need actual coverage report)
        # Simulated: assume good if tests pass
        test_pass = 1 if gates.get("test") == "passed" else 0
        coverage_score = test_pass * 100
        print(f"   Test Pass:       {'PASS' if test_pass else 'FAIL'}")
        
        # Build Success Rate
        build_pass = 1 if gates.get("build") == "passed" else 0
        build_rate = build_pass * 100
        print(f"   Build:           {'PASS' if build_pass else 'FAIL'}")
        
        self.quality_data = {
            "quality_base": quality_base,
            "type_rate": type_rate,
            "coverage_score": coverage_score,
            "build_rate": build_rate
        }
        
        return self.quality_data
    
    # ====================
    # BEHAVIOR METRICS (15%)
    # ====================
    
    def measure_behavior(self) -> Dict[str, float]:
        print()
        print("3. BEHAVIOR (15%)")
        print("-" * 50)
        
        state = self.load_state()
        
        # State Update Rate
        last_updated = state.get("lastUpdated", "")
        if last_updated:
            try:
                update_date = datetime.fromisoformat(last_updated)
                days_since = (datetime.now() - update_date).days
                if days_since == 0:
                    update_rate = 100
                elif days_since == 1:
                    update_rate = 80
                elif days_since <= 7:
                    update_rate = 50
                else:
                    update_rate = 20
            except:
                update_rate = 50
        else:
            update_rate = 0
        
        print(f"   Last State Update: {last_updated or 'Never'}")
        print(f"   Update Rate:       {update_rate:.0f}%")
        
        # Change Tracking
        recent_changes = len(state.get("recentChanges", []))
        tracking_score = min(100, recent_changes * 20)
        print(f"   Recent Changes:   {recent_changes}")
        print(f"   Tracking Score:   {tracking_score:.0f}")
        
        # Constraint Violations (would need violation tracking)
        violations = 0
        violation_score = max(0, 100 - violations * 10)
        print(f"   Violations:       {violations}")
        print(f"   Violation Score:  {violation_score:.0f}")
        
        self.behavior_data = {
            "update_rate": update_rate,
            "tracking_score": tracking_score,
            "violation_score": violation_score
        }
        
        return self.behavior_data
    
    # ====================
    # AUTONOMY METRICS (15%)
    # ====================
    
    def measure_autonomy(self) -> Dict[str, float]:
        print()
        print("4. AUTONOMY (15%)")
        print("-" * 50)
        
        state = self.load_state()
        metrics = state.get("metrics", {})
        
        # Solo Completion Rate
        solo = metrics.get("tasksCompleted", 0)
        human_interventions = metrics.get("humanInterventions", 0)
        total_ops = solo + human_interventions
        
        if total_ops > 0:
            autonomy_rate = (solo / total_ops) * 100
        else:
            autonomy_rate = 100  # No data = assume good
        
        print(f"   Solo Completions: {solo}")
        print(f"   Human Interventions: {human_interventions}")
        print(f"   Autonomy Rate:   {autonomy_rate:.1f}%")
        
        # Self-Correction Rate (Agent fixes own mistakes)
        self_corrections = 0
        corrections_rate = min(100, self_corrections * 20)
        print(f"   Self-Corrections: {self_corrections}")
        print(f"   Correction Rate:  {corrections_rate:.0f}%")
        
        # Escalation Rate (when agent asks for help appropriately)
        escalations = metrics.get("escalations", 0)
        escalation_score = max(0, 100 - escalations * 5)
        print(f"   Escalations:      {escalations}")
        print(f"   Escalation Score: {escalation_score:.0f}%")
        
        self.autonomy_data = {
            "autonomy_rate": autonomy_rate,
            "corrections_rate": corrections_rate,
            "escalation_score": escalation_score
        }
        
        return self.autonomy_data
    
    # ====================
    # SCORING
    # ====================
    
    def calculate_overall_score(self) -> Tuple[float, str, str]:
        """Calculate weighted overall score."""
        # Weights
        W = {
            "completion": 15,      # Efficiency
            "gate": 10,
            "block": 5,
            "quality": 20,
            "type": 5,
            "coverage": 5,
            "update": 5,           # Behavior
            "tracking": 5,
            "violation": 5,
            "autonomy": 10,         # Autonomy
            "correction": 5,
        }
        
        total_weight = sum(W.values())
        
        # Calculate components
        completion = min(100, max(0, self.efficiency_data.get("completion_rate", 100)))
        gate = min(100, max(0, self.efficiency_data.get("gate_pass_rate", 100)))
        block = min(100, max(0, 100 - self.efficiency_data.get("block_rate", 0)))
        quality = min(100, max(0, self.quality_data.get("quality_base", 100)))
        type_rate = min(100, max(0, self.quality_data.get("type_rate", 100)))
        coverage = min(100, max(0, self.quality_data.get("coverage_score", 100)))
        update = min(100, max(0, self.behavior_data.get("update_rate", 100)))
        tracking = min(100, max(0, self.behavior_data.get("tracking_score", 100)))
        violation = min(100, max(0, self.behavior_data.get("violation_score", 100)))
        autonomy = min(100, max(0, self.autonomy_data.get("autonomy_rate", 100)))
        correction = min(100, max(0, self.autonomy_data.get("corrections_rate", 100)))
        
        # Weighted sum
        overall = (
            completion * W["completion"] +
            gate * W["gate"] +
            block * W["block"] +
            quality * W["quality"] +
            type_rate * W["type"] +
            coverage * W["coverage"] +
            update * W["update"] +
            tracking * W["tracking"] +
            violation * W["violation"] +
            autonomy * W["autonomy"] +
            correction * W["correction"]
        ) / total_weight
        
        # Grade
        if overall >= 95: grade, desc = "S+", "World Class"
        elif overall >= 90: grade, desc = "S", "Excellent"
        elif overall >= 85: grade, desc = "A+", "Outstanding"
        elif overall >= 80: grade, desc = "A", "Very Good"
        elif overall >= 75: grade, desc = "B+", "Good"
        elif overall >= 70: grade, desc = "B", "Satisfactory"
        elif overall >= 65: grade, desc = "C+", "Acceptable"
        elif overall >= 60: grade, desc = "C", "Marginal"
        elif overall >= 50: grade, desc = "D", "Poor"
        else: grade, desc = "F", "Fail"
        
        return overall, grade, desc
    
    def generate_recommendations(self) -> List[str]:
        """Generate actionable recommendations."""
        recs = []
        
        # Efficiency
        if self.efficiency_data.get("completion_rate", 100) < 85:
            recs.append(f"Completion rate low ({self.efficiency_data['completion_rate']:.0f}%) - review task definition")
        if self.efficiency_data.get("block_rate", 0) > 10:
            recs.append(f"Block rate high ({self.efficiency_data['block_rate']:.0f}%) - improve /blocked usage")
        if self.efficiency_data.get("gate_pass_rate", 100) < 90:
            recs.append(f"Gate pass rate low ({self.efficiency_data['gate_pass_rate']:.0f}%) - improve code quality before PR")
        
        # Quality
        if self.quality_data.get("quality_base", 100) < 100:
            console = self.quality_data.get("quality_base", 100)
            recs.append(f"Code quality issues - run lint fix")
        
        # Behavior
        if self.behavior_data.get("update_rate", 100) < 80:
            recs.append("State not updated recently - maintain state.json")
        if self.behavior_data.get("tracking_score", 0) < 50:
            recs.append("Low change tracking - record recentChanges")
        
        # Autonomy
        if self.autonomy_data.get("autonomy_rate", 100) < 70:
            recs.append("Human intervention too high - define clearer task boundaries")
        
        return recs
    
    def run(self) -> BenchmarkResult:
        """Run full benchmark."""
        print()
        print("=" * 60)
        print("  HARNESS EFFECTIVENESS BENCHMARK v2")
        print("=" * 60)
        print(f"  Project: {self.project_path}")
        print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        # Run all measurements
        self.measure_efficiency()
        self.measure_quality()
        self.measure_behavior()
        self.measure_autonomy()
        
        # Calculate score
        overall, grade, desc = self.calculate_overall_score()
        recommendations = self.generate_recommendations()
        
        # Print results
        print()
        print("=" * 60)
        print("  RESULTS")
        print("=" * 60)
        print()
        print(f"   {'FINAL SCORE':20} {overall:6.1f}/100")
        print(f"   {'GRADE':20} {grade} ({desc})")
        print()
        
        print("   BREAKDOWN:")
        print(f"   {'Efficiency':20} {self.efficiency_data.get('completion_rate', 0):6.1f}%  (completion)")
        print(f"   {'Quality':20} {self.quality_data.get('quality_base', 0):6.1f}%  (code issues)")
        print(f"   {'Behavior':20} {self.behavior_data.get('update_rate', 0):6.1f}%  (state mgmt)")
        print(f"   {'Autonomy':20} {self.autonomy_data.get('autonomy_rate', 0):6.1f}%  (self-sufficiency)")
        print()
        
        if recommendations:
            print("   RECOMMENDATIONS:")
            for i, rec in enumerate(recommendations, 1):
                print(f"   {i}. {rec}")
            print()
        
        return BenchmarkResult(
            efficiency=self.efficiency_data,
            quality=self.quality_data,
            behavior=self.behavior_data,
            autonomy=self.autonomy_data,
            overall=overall,
            grade=grade,
            grade_desc=desc,
            timestamp=datetime.now().isoformat(),
            recommendations=recommendations
        )


def main():
    parser = argparse.ArgumentParser(description="Harness Effectiveness Benchmark v2")
    parser.add_argument("--project", "-p", default=".", help="Project path")
    parser.add_argument("--baseline", "-b", default=None, help="Baseline for comparison")
    parser.add_argument("--output", "-o", choices=["text", "json"], default="text", help="Output format")
    parser.add_argument("--save", "-s", help="Save result to file")
    args = parser.parse_args()
    
    benchmark = HarnessBenchmark(args.project, args.baseline)
    result = benchmark.run()
    
    if args.save:
        with open(args.save, "w") as f:
            json.dump(asdict(result), f, indent=2)
        print(f"   Results saved to: {args.save}")
    
    # Exit code = 100 - score
    sys.exit(int(100 - result.overall))


if __name__ == "__main__":
    main()
