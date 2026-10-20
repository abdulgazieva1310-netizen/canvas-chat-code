"""Known-correct and deliberately incorrect submissions for reviewed judges.

Run ``CODING_RUNNER_INTEGRATION=1 uv run --project backend pytest -q
coding-runner/test_judge_references.py`` on a host with Docker and the promoted
executor image. These programs use the same stdin/stdout contracts as candidates.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

import server
from app.routers.interviews import JUDGE_CASES


CORRECT = {
    "Python": {
        "first-repeat-v1": """import sys, json
t = sys.stdin.read().split()
try:
 n = int(t[0]); values = list(map(int, t[1:]))
 out = None
 if 0 <= n <= 100000 and len(values) == n and all(-2147483648 <= x <= 2147483647 for x in values):
  seen = set()
  for x in values:
   if x in seen: out = x; break
   seen.add(x)
  print(json.dumps(out))
 else: print('null')
except: print('null')
""",
        "runs-v1": """import sys, json
t = sys.stdin.read().split()
try:
 n = int(t[0]); a = list(map(int,t[1:])); out=[]
 if 0 <= n <= 100000 and len(a)==n and all(-2147483648 <= x <= 2147483647 for x in a):
  for x in a:
   if out and out[-1][0]==x: out[-1][1]+=1
   else: out.append([x,1])
  print(json.dumps(out,separators=(',',':')))
 else: print('[]')
except: print('[]')
""",
        "merge-sorted-v1": """import sys, json
t = sys.stdin.read().split()
try:
 n,m=map(int,t[:2]); a=list(map(int,t[2:2+n])); b=list(map(int,t[2+n:]));
 if n<0 or m<0 or n+m>100000 or len(a)!=n or len(b)!=m or a!=sorted(a) or b!=sorted(b) or any(x < -2147483648 or x > 2147483647 for x in a+b): print('[]')
 else:
  out=[]; i=j=0
  while i<n and j<m:
   if a[i]<=b[j]: out.append(a[i]); i+=1
   else: out.append(b[j]); j+=1
  out.extend(a[i:]); out.extend(b[j:]); print(json.dumps(out,separators=(',',':')))
except: print('[]')
""",
    },
    "JavaScript": {
        "first-repeat-v1": """const t=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out=null;
try { const n=Number(t[0]), a=t.slice(1).map(Number); if(Number.isInteger(n)&&n>=0&&n<=100000&&a.length===n&&a.every(Number.isInteger)){const s=new Set(); for(const x of a){if(x < -2147483648||x>2147483647) throw 0; if(s.has(x)){out=x;break;} s.add(x);}} } catch {out=null;} console.log(JSON.stringify(out));
""",
        "runs-v1": """const t=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out=[];
try { const n=Number(t[0]), a=t.slice(1).map(Number); if(!Number.isInteger(n)||n<0||n>100000||a.length!==n||a.some(x=>!Number.isInteger(x)||x < -2147483648||x>2147483647)) throw 0; for(const x of a){if(out.length&&out.at(-1)[0]===x) out.at(-1)[1]++; else out.push([x,1]);} } catch {out=[];} console.log(JSON.stringify(out));
""",
        "merge-sorted-v1": """const t=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out=[];
try { const n=Number(t[0]),m=Number(t[1]),a=t.slice(2,2+n).map(Number),b=t.slice(2+n).map(Number); if(!Number.isInteger(n)||!Number.isInteger(m)||n<0||m<0||n+m>100000||a.length!==n||b.length!==m||a.some((x,i)=>!Number.isInteger(x)||x < -2147483648||x>2147483647||(i&&x<a[i-1]))||b.some((x,i)=>!Number.isInteger(x)||x < -2147483648||x>2147483647||(i&&x<b[i-1]))) throw 0; let i=0,j=0; while(i<n&&j<m) out.push(a[i]<=b[j]?a[i++]:b[j++]); console.log(JSON.stringify(out.concat(a.slice(i),b.slice(j)))); } catch {console.log('[]');}
""",
    },
    "TypeScript": {
        "first-repeat-v1": """declare function require(name: string): any;
const t: string[] = require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out: number|null=null;
try { const n=Number(t[0]), a=t.slice(1).map(Number); if(Number.isInteger(n)&&n>=0&&n<=100000&&a.length===n&&a.every(Number.isInteger)){const s=new Set<number>(); for(const x of a){if(x < -2147483648||x>2147483647) throw 0; if(s.has(x)){out=x;break;} s.add(x);}} } catch {out=null;} console.log(JSON.stringify(out));
""",
        "runs-v1": """declare function require(name: string): any;
const t: string[] = require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out: number[][]=[];
try { const n=Number(t[0]), a=t.slice(1).map(Number); if(!Number.isInteger(n)||n<0||n>100000||a.length!==n||a.some(x=>!Number.isInteger(x)||x < -2147483648||x>2147483647)) throw 0; for(const x of a){const last=out[out.length-1]; if(last&&last[0]===x) last[1]++; else out.push([x,1]);} } catch {out=[];} console.log(JSON.stringify(out));
""",
        "merge-sorted-v1": """declare function require(name: string): any;
const t: string[] = require('fs').readFileSync(0,'utf8').trim().split(/\\s+/); let out: number[]=[];
try { const n=Number(t[0]),m=Number(t[1]),a=t.slice(2,2+n).map(Number),b=t.slice(2+n).map(Number); if(!Number.isInteger(n)||!Number.isInteger(m)||n<0||m<0||n+m>100000||a.length!==n||b.length!==m||a.some((x,i)=>!Number.isInteger(x)||x < -2147483648||x>2147483647||(i&&x<a[i-1]))||b.some((x,i)=>!Number.isInteger(x)||x < -2147483648||x>2147483647||(i&&x<b[i-1]))) throw 0; let i=0,j=0; while(i<n&&j<m) out.push(a[i]<=b[j]?a[i++]:b[j++]); console.log(JSON.stringify(out.concat(a.slice(i),b.slice(j)))); } catch {console.log('[]');}
""",
    },
    "Java": {
        "first-repeat-v1": """import java.util.*; class Solution { public static void main(String[] z){ Scanner s=new Scanner(System.in); try {int n=s.nextInt(); if(n<0||n>100000) throw new Exception(); Set<Integer> seen=new HashSet<>(); Integer out=null; for(int i=0;i<n;i++){int x=s.nextInt(); if(seen.contains(x)){out=x; break;} seen.add(x);} if(out==null) { /* remaining values still need validation */ while(s.hasNextInt()) s.nextInt(); } System.out.println(out==null?"null":out);} catch(Exception e){System.out.println("null");} } }
""",
        "runs-v1": """import java.util.*; class Solution { public static void main(String[] z){ Scanner s=new Scanner(System.in); try {int n=s.nextInt(); if(n<0||n>100000) throw new Exception(); List<int[]> o=new ArrayList<>(); for(int i=0;i<n;i++){int x=s.nextInt(); if(o.size()>0&&o.get(o.size()-1)[0]==x)o.get(o.size()-1)[1]++;else o.add(new int[]{x,1});} StringJoiner j=new StringJoiner(",","[","]"); for(int[] p:o)j.add("["+p[0]+","+p[1]+"]"); System.out.println(j);}catch(Exception e){System.out.println("[]");} } }
""",
        "merge-sorted-v1": """import java.util.*; class Solution { public static void main(String[] z){ Scanner s=new Scanner(System.in); try {int n=s.nextInt(),m=s.nextInt(); if(n<0||m<0||n+m>100000)throw new Exception(); int[] a=new int[n],b=new int[m]; for(int i=0;i<n;i++)a[i]=s.nextInt();for(int i=0;i<m;i++)b[i]=s.nextInt(); for(int i=1;i<n;i++)if(a[i]<a[i-1])throw new Exception();for(int i=1;i<m;i++)if(b[i]<b[i-1])throw new Exception();List<Integer> o=new ArrayList<>();int i=0,j=0;while(i<n&&j<m)o.add(a[i]<=b[j]?a[i++]:b[j++]);while(i<n)o.add(a[i++]);while(j<m)o.add(b[j++]);StringJoiner out=new StringJoiner(",","[","]");for(int x:o)out.add(Integer.toString(x));System.out.println(out);}catch(Exception e){System.out.println("[]");} } }
""",
    },
    "C++": {
        "first-repeat-v1": """#include <iostream>
#include <string>
#include <unordered_set>
using namespace std; int main(){int n;if(!(cin>>n)||n<0||n>100000){cout<<"null\\n";return 0;} unordered_set<int>s; int out;bool found=false;for(int i=0,x;i<n;i++){if(!(cin>>x)){cout<<"null\\n";return 0;}if(!found&&s.count(x)){out=x;found=true;}s.insert(x);} cout<<(found?to_string(out):"null")<<"\\n";}
""",
        "runs-v1": """#include <iostream>
#include <vector>
using namespace std; int main(){int n;if(!(cin>>n)||n<0||n>100000){cout<<"[]\\n";return 0;}vector<pair<int,int>>o;for(int i=0,x;i<n;i++){if(!(cin>>x)){cout<<"[]\\n";return 0;}if(o.size()&&o.back().first==x)o.back().second++;else o.push_back({x,1});}cout<<"[";for(int i=0;i<(int)o.size();i++){if(i)cout<<",";cout<<"["<<o[i].first<<","<<o[i].second<<"]";}cout<<"]\\n";}
""",
        "merge-sorted-v1": """#include <algorithm>
#include <iostream>
#include <iterator>
#include <vector>
using namespace std; int main(){int n,m;if(!(cin>>n>>m)||n<0||m<0||n+m>100000){cout<<"[]\\n";return 0;}vector<int>a(n),b(m),o;for(int&x:a)if(!(cin>>x)){cout<<"[]\\n";return 0;}for(int&x:b)if(!(cin>>x)){cout<<"[]\\n";return 0;}if(!is_sorted(a.begin(),a.end())||!is_sorted(b.begin(),b.end())){cout<<"[]\\n";return 0;}merge(a.begin(),a.end(),b.begin(),b.end(),back_inserter(o));cout<<"[";for(int i=0;i<(int)o.size();i++){if(i)cout<<",";cout<<o[i];}cout<<"]\\n";}
""",
    },
}

WRONG = {
    "Python": "print('wrong')\n",
    "JavaScript": "console.log('wrong');\n",
    "TypeScript": "console.log('wrong');\n",
    "Java": "class Solution { public static void main(String[] a) { System.out.println(\"wrong\"); } }\n",
    "C++": "#include <iostream>\nint main(){std::cout << \"wrong\\n\";}\n",
}


def execute(language, source, stdin):
    directory = Path(tempfile.mkdtemp(dir=server.SOURCE_DIR))
    source_path = directory / "source"
    source_path.write_text(source, encoding="utf-8")
    source_path.chmod(0o444)
    try:
        return server.run_container(language, source_path, stdin)
    finally:
        import shutil
        shutil.rmtree(directory, ignore_errors=True)


@pytest.mark.skipif(os.getenv("CODING_RUNNER_INTEGRATION") != "1", reason="requires Docker and the executor image")
@pytest.mark.parametrize("language", list(CORRECT))
@pytest.mark.parametrize("judge_key", ["first-repeat-v1", "runs-v1", "merge-sorted-v1"])
def test_known_correct_reference_passes_all_reviewed_cases(language, judge_key, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SOURCE_DIR", tmp_path)
    for _category, stdin, expected in JUDGE_CASES[judge_key]:
        result = execute(language, CORRECT[language][judge_key], stdin)
        assert result["status"] == "success", (language, judge_key, result)
        assert result["stdout"] == expected, (language, judge_key, stdin, result["stdout"], expected)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.skipif(os.getenv("CODING_RUNNER_INTEGRATION") != "1", reason="requires Docker and the executor image")
@pytest.mark.parametrize("language", list(CORRECT))
@pytest.mark.parametrize("judge_key", ["first-repeat-v1", "runs-v1", "merge-sorted-v1"])
def test_deliberately_incorrect_reference_is_rejected(language, judge_key, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SOURCE_DIR", tmp_path)
    _category, stdin, expected = JUDGE_CASES[judge_key][0]
    result = execute(language, WRONG[language], stdin)
    assert result["status"] == "success", (language, judge_key, result)
    assert result["stdout"] != expected, (language, judge_key, "incorrect reference unexpectedly passed")
    assert list(tmp_path.iterdir()) == []
