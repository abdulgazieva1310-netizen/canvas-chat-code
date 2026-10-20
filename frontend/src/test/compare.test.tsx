import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory,createRootRoute,createRoute,createRouter,Outlet,RouterProvider } from "@tanstack/react-router";
import { afterEach,expect,it,vi } from "vitest";
import { Route,comparisonSearch,compatibleReports,scoreDelta } from "@/routes/compare";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import type { InterviewReport } from "@/lib/api/types";
vi.mock("@/components/AppShell",()=>({AppShell:({children}:any)=><div>{children}</div>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function report(id:string,overall:number|null=7):InterviewReport {
  return {interview:{id,setup:defaultSetup,status:"incomplete",startedAt:"2026-10-20T00:00:00Z",endedAt:"2026-10-20T00:10:00Z",answeredCount:1,messages:[],lastFeedback:null},feedback:{interviewId:id,answeredQuestions:1,selectedQuestions:5,overall,scores:{accuracy:overall,completeness:null,clarity:5,structure:null},strengths:["Clear example"],gaps:["Discuss trade-offs"],questions:[]}};
}
function open(url="/compare?first=one&second=two") {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const root=createRootRoute({component:Outlet});
  const route=createRoute({getParentRoute:()=>root,path:"/compare",validateSearch:Route.options.validateSearch!,component:Route.options.component!});
  const router=createRouter({routeTree:root.addChildren([route]),history:createMemoryHistory({initialEntries:[url]})});
  render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);return client;
}
it("shows saved partial reports, signed deltas and missing scores without new assessments",async()=>{
  const get=vi.spyOn(Api,"getReport").mockImplementation(async id=>report(id,id==="one" ? 7 : 8.5));
  const client=open();
  await screen.findByRole("heading",{name:"Compare saved reports"});
  expect(screen.getAllByText("+1.5")).toHaveLength(2);
  expect(screen.getAllByText("Not comparable")).toHaveLength(2);
  expect(screen.getAllByText(/Incomplete \(partial results\)/)).toHaveLength(2);
  expect(get).toHaveBeenCalledTimes(2);client.clear();
});
it.each(["role","type","mode","language"] as const)("rejects numeric comparisons across %s",async field=>{
  const a=report("one");const b=report("two",9);
  b.interview.setup={...b.interview.setup,...{[field]:({role:"Data Analyst",type:"Behavioral",mode:"Real Interview",language:"Russian"} as any)[field]}};
  expect(compatibleReports(a,b)).toBe(false);
  vi.spyOn(Api,"getReport").mockImplementation(async id=>id==="one" ? a:b);
  const client=open();await screen.findByRole("alert");
  expect(screen.queryByRole("columnheader",{name:"Change"})).toBeNull();client.clear();
});
it("retries unavailable or inaccessible reports without exposing partial comparison data",async()=>{
  vi.spyOn(Api,"getReport").mockRejectedValueOnce(new Error("Not found")).mockImplementation(async id=>report(id));
  const client=open();await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{name:"Retry comparison"}));
  await screen.findByRole("heading",{name:"Compare saved reports"});client.clear();
});
it.each(["/compare","/compare?first=one&second=one"])("requires two distinct IDs for %s",async url=>{
  const get=vi.spyOn(Api,"getReport");const client=open(url);
  await screen.findByText("Select two distinct saved reports in History.");expect(get).not.toHaveBeenCalled();client.clear();
});
it("normalizes search and never treats null scores as zero",()=>{
  expect(comparisonSearch({first:" one ",second:4})).toEqual({first:"one",second:""});
  expect(scoreDelta(null,9)).toBe("Not comparable");expect(scoreDelta(9,7)).toBe("-2.0");
});
